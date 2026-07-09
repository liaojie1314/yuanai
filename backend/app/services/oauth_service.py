"""三方登录（GitHub 优先）编排。

流程：
  1. 前端 GET `/api/v1/auth/github` → 后端生成随机 state，写 Redis 5 分钟过期，
     302 到 GitHub authorize URL；
  2. 用户在 GitHub 授权后，GitHub 302 到后端 `/callback?code&state`；
  3. 后端校验 state，POST access_token endpoint 换 access_token，
     再 GET `/user` + `/user/emails` 拿到 GitHub 账号信息；
  4. 依据 github_id / email 关联或新建本地用户，签发 JWT，
     302 回前端 `/oauth/callback?access_token=...&refresh_token=...&expires_in=...`。

若前端已配置 `web_app_url`，回跳会包含短生命 access_token（默认 15 分钟）和 refresh_token（30 天）。
前端 callback 页面读取 URL 参数写入 auth store 后立即 replaceState 清 URL。
"""
from __future__ import annotations

import secrets
import uuid
from typing import cast
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import redis_client
from app.models.user import User
from app.schemas.auth import AuthResponse

# ── 常量 ────────────────────────────────────────────
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_USER = "https://api.github.com/user"
GITHUB_API_EMAILS = "https://api.github.com/user/emails"

# state 生存期：5 分钟足以覆盖用户授权耗时，避免 Redis 长期堆积
_STATE_TTL_SECONDS = 5 * 60
_STATE_KEY_PREFIX = "oauth:github:state:"


class OAuthConfigError(Exception):
    """未配置 GitHub OAuth credentials —— 端点应返回 503 引导管理员配置。"""


class OAuthFlowError(Exception):
    """OAuth 流程异常（state 非法 / GitHub 拒绝 / 无邮箱）。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _ensure_configured() -> None:
    if not settings.github_client_id or not settings.github_client_secret:
        raise OAuthConfigError(
            "GitHub OAuth 未配置（缺少 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）"
        )


async def build_github_authorize_url() -> str:
    """生成 GitHub 授权 URL；把 state 写入 Redis 用于 CSRF 校验。"""
    _ensure_configured()
    state = secrets.token_urlsafe(32)
    await redis_client.setex(_STATE_KEY_PREFIX + state, _STATE_TTL_SECONDS, "1")
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        # user:email 是拿到 primary email 的最小 scope；read:user 用于取 login/avatar
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def _verify_state(state: str) -> bool:
    """一次性校验并删除 state；不存在 / 过期 → False。"""
    key = _STATE_KEY_PREFIX + state
    val = await redis_client.get(key)
    if val is None:
        return False
    await redis_client.delete(key)
    return True


async def _exchange_code_for_token(code: str) -> str:
    """用 authorization code 换 GitHub access_token。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        raise OAuthFlowError("OAUTH_TOKEN_EXCHANGE_FAILED", "GitHub 拒绝换取访问令牌")
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        # GitHub 一般用 error / error_description 描述失败，这里合并透传
        detail = payload.get("error_description") or payload.get("error") or "无 access_token"
        raise OAuthFlowError("OAUTH_TOKEN_EXCHANGE_FAILED", f"GitHub 拒绝换取访问令牌：{detail}")
    return cast(str, token)


async def _fetch_github_profile(access_token: str) -> dict[str, str]:
    """拿 GitHub 用户信息 + primary email；返回统一 dict。"""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        user_resp = await client.get(GITHUB_API_USER, headers=headers)
        if user_resp.status_code != 200:
            raise OAuthFlowError("OAUTH_PROFILE_FETCH_FAILED", "无法获取 GitHub 用户信息")
        user = user_resp.json()

        # 若 profile 里已带 primary email 就不必再请求 emails 端点
        email = user.get("email")
        if not email:
            emails_resp = await client.get(GITHUB_API_EMAILS, headers=headers)
            if emails_resp.status_code == 200:
                for item in emails_resp.json():
                    if item.get("primary") and item.get("verified"):
                        email = item.get("email")
                        break

    if not email:
        raise OAuthFlowError(
            "OAUTH_EMAIL_UNAVAILABLE",
            "GitHub 账号未公开可用邮箱，请在 GitHub 设置里公开 primary email 后重试",
        )
    return {
        "github_id": str(user["id"]),
        "email": str(email).lower(),
        "login": str(user.get("login") or f"gh{user['id']}"),
        "avatar_url": str(user.get("avatar_url") or ""),
    }


async def _link_or_create_user(profile: dict[str, str], db: AsyncSession) -> User:
    """按 github_id → email 顺序查找账号：找到就关联；都没有就新建。"""
    github_id = profile["github_id"]
    email = profile["email"]

    # 1) 已按 github_id 关联的用户
    user = (
        await db.execute(select(User).where(User.github_id == github_id))
    ).scalar_one_or_none()
    if user:
        return user

    # 2) 邮箱已存在但未关联 → 补写 github_id 完成关联
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        user.github_id = github_id
        # 若原头像为空，用 GitHub 头像补齐（不覆盖用户自定义头像）
        if not user.avatar_url and profile["avatar_url"]:
            user.avatar_url = profile["avatar_url"]
        await db.commit()
        await db.refresh(user)
        return user

    # 3) 全新用户：邮箱 + github_id 唯一，hashed_password 保留 NULL
    username = await _pick_available_username(profile["login"], email, db)
    user = User(
        id=uuid.uuid4(),
        email=email,
        username=username,
        hashed_password=None,
        github_id=github_id,
        avatar_url=profile["avatar_url"] or None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _pick_available_username(base: str, email: str, db: AsyncSession) -> str:
    """从 GitHub login 生成本地 username；已存在则递增后缀。

    User 模型要求 2-20 位 [a-zA-Z0-9_中文]，GitHub login 已满足前段字符集，
    仅需处理超长和冲突。
    """
    candidate = base.strip() or email.split("@", 1)[0]
    candidate = candidate[:16] or "githubuser"
    # 逐个尝试：候选 / 候选1 / 候选2 …；控制在 20 位以内
    for suffix in ("", *(str(i) for i in range(1, 100))):
        name = (candidate + suffix)[:20]
        exists = (
            await db.execute(select(User).where(User.username == name))
        ).scalar_one_or_none()
        if not exists:
            return name
    # 极端兜底：随机短 hex，保证唯一
    return f"gh_{secrets.token_hex(6)}"


async def complete_github_callback(code: str, state: str, db: AsyncSession) -> AuthResponse:
    """走完整回调：校验 state → 换 token → 拉资料 → 关联/建号 → 签 JWT。"""
    _ensure_configured()
    if not await _verify_state(state):
        raise OAuthFlowError("OAUTH_STATE_INVALID", "state 参数无效或已过期，请重新发起登录")

    access_token = await _exchange_code_for_token(code)
    profile = await _fetch_github_profile(access_token)
    user = await _link_or_create_user(profile, db)

    # 复用 auth_service 的 refresh token 写 Redis 逻辑，避免两处代码分叉
    from app.services.auth_service import build_auth_response

    return await build_auth_response(user)


def build_frontend_redirect(resp: AuthResponse) -> str:
    """把 AuthResponse 拼到前端 callback 页面 URL 上，供 302 使用。"""
    params = {
        "access_token": resp.access_token,
        "refresh_token": resp.refresh_token,
        "token_type": resp.token_type,
        "expires_in": str(settings.access_token_expire_minutes * 60),
    }
    return f"{settings.web_app_url.rstrip('/')}/oauth/callback?{urlencode(params)}"


def build_frontend_error_redirect(code: str, message: str) -> str:
    """OAuth 失败时的前端跳转，用于统一在 callback 页面弹出错误提示。"""
    params = {"error": code, "error_description": message}
    return f"{settings.web_app_url.rstrip('/')}/oauth/callback?{urlencode(params)}"


__all__ = [
    "OAuthConfigError",
    "OAuthFlowError",
    "build_frontend_error_redirect",
    "build_frontend_redirect",
    "build_github_authorize_url",
    "complete_github_callback",
]
