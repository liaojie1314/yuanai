"""三方登录（GitHub / Google）编排。

流程（以 GitHub 为例，Google 同构）：
  1. 前端 GET `/api/v1/auth/{provider}` → 后端生成随机 state，写 Redis 5 分钟过期，
     302 到 provider 的 authorize URL；
  2. 用户授权后，provider 302 到后端 `/{provider}/callback?code&state`；
  3. 后端校验 state，POST token endpoint 换 access_token，再拉取用户资料；
  4. 依据 `{provider}_id` / email 关联或新建本地用户，签发 JWT，
     302 回前端 `/oauth/callback?access_token=...&refresh_token=...&expires_in=...`。

若前端已配置 `web_app_url`，回跳会包含短生命 access_token（默认 15 分钟）和 refresh_token（30 天）。
前端 callback 页面读取 URL 参数写入 auth store 后立即 replaceState 清 URL。

账号关联对所有 provider 一致：先按 `{provider}_id` 命中直接登录；否则按 email 命中则
补写 `{provider}_id` 完成关联；都没有则新建 OAuth-only 用户（`hashed_password=None`）。
"""

from __future__ import annotations

import re
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

# ── GitHub 常量 ──────────────────────────────────────
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_USER = "https://api.github.com/user"
GITHUB_API_EMAILS = "https://api.github.com/user/emails"

# ── Google 常量 ──────────────────────────────────────
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_API_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"

# state 生存期：5 分钟足以覆盖用户授权耗时，避免 Redis 长期堆积
_STATE_TTL_SECONDS = 5 * 60


def _state_key(provider: str, state: str) -> str:
    """按 provider 隔离 state key，避免跨 provider 串用。"""
    return f"oauth:{provider}:state:{state}"


class OAuthConfigError(Exception):
    """未配置 provider OAuth credentials —— 端点应返回 503 引导管理员配置。"""


class OAuthFlowError(Exception):
    """OAuth 流程异常（state 非法 / provider 拒绝 / 无邮箱）。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _ensure_configured(provider: str) -> None:
    """校验目标 provider 的 client_id / client_secret 均已配置。"""
    if provider == "github":
        ok = bool(settings.github_client_id and settings.github_client_secret)
        detail = "GitHub OAuth 未配置（缺少 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）"
    elif provider == "google":
        ok = bool(settings.google_client_id and settings.google_client_secret)
        detail = "Google OAuth 未配置（缺少 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）"
    else:
        raise OAuthConfigError(f"未知的 OAuth provider：{provider}")
    if not ok:
        raise OAuthConfigError(detail)


async def _write_state(provider: str, *, mobile: bool = False) -> str:
    """生成随机 state 写入 Redis（provider 隔离），返回 state 供拼 URL。

    Redis value 存 ``web`` / ``mobile``，callback 时据此决定回跳 Web 还是 deep link。
    """
    state = secrets.token_urlsafe(32)
    flag = "mobile" if mobile else "web"
    await redis_client.setex(_state_key(provider, state), _STATE_TTL_SECONDS, flag)
    return state


async def _verify_state(provider: str, state: str) -> str | None:
    """一次性校验并删除 state。

    返回 ``\"web\"`` / ``\"mobile\"``；不存在 / 过期 → None。
    兼容历史 value ``\"1\"``（视为 web）。
    """
    key = _state_key(provider, state)
    val = await redis_client.get(key)
    if val is None:
        return None
    await redis_client.delete(key)
    raw = val.decode() if isinstance(val, (bytes, bytearray)) else str(val)
    if raw == "mobile":
        return "mobile"
    return "web"


# ── GitHub 授权 URL / token / profile ────────────────
async def build_github_authorize_url(*, mobile: bool = False) -> str:
    """生成 GitHub 授权 URL；把 state 写入 Redis 用于 CSRF 校验。"""
    _ensure_configured("github")
    state = await _write_state("github", mobile=mobile)
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        # user:email 是拿到 primary email 的最小 scope；read:user 用于取 login/avatar
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def _exchange_code_for_token(code: str) -> str:
    """用 authorization code 换 GitHub access_token。

    包裹网络异常为 `OAuthFlowError`（跨境访问 github.com 常出现 ConnectTimeout /
    ReadTimeout / DNS 失败等），让 callback 端点统一走前端错误重定向而非 500。
    """
    try:
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
    except httpx.RequestError as e:
        raise OAuthFlowError(
            "OAUTH_NETWORK_ERROR",
            f"无法连接 GitHub 授权服务，请检查网络或代理配置：{type(e).__name__}",
        ) from e
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
    """拿 GitHub 用户信息 + primary email；返回统一 profile dict（`provider_id` 键）。"""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
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
    except httpx.RequestError as e:
        raise OAuthFlowError(
            "OAUTH_NETWORK_ERROR",
            f"无法连接 GitHub API：{type(e).__name__}",
        ) from e

    if not email:
        raise OAuthFlowError(
            "OAUTH_EMAIL_UNAVAILABLE",
            "GitHub 账号未公开可用邮箱，请在 GitHub 设置里公开 primary email 后重试",
        )
    return {
        "provider_id": str(user["id"]),
        "email": str(email).lower(),
        "login": str(user.get("login") or f"gh{user['id']}"),
        "avatar_url": str(user.get("avatar_url") or ""),
    }


# ── Google 授权 URL / token / profile ────────────────
async def build_google_authorize_url(*, mobile: bool = False) -> str:
    """生成 Google 授权 URL；把 state 写入 Redis 用于 CSRF 校验。"""
    _ensure_configured("google")
    state = await _write_state("google", mobile=mobile)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        # openid+email+profile 足以拿到 sub / email / name / picture
        "scope": "openid email profile",
        "state": state,
        # 每次都要 refresh 无需求；prompt=select_account 让用户可切换账号
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


async def _exchange_google_code_for_token(code: str) -> str:
    """用 authorization code 换 Google access_token。"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Accept": "application/json"},
            )
    except httpx.RequestError as e:
        raise OAuthFlowError(
            "OAUTH_NETWORK_ERROR",
            f"无法连接 Google 授权服务，请检查网络或代理配置：{type(e).__name__}",
        ) from e
    if resp.status_code != 200:
        raise OAuthFlowError("OAUTH_TOKEN_EXCHANGE_FAILED", "Google 拒绝换取访问令牌")
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        detail = payload.get("error_description") or payload.get("error") or "无 access_token"
        raise OAuthFlowError("OAUTH_TOKEN_EXCHANGE_FAILED", f"Google 拒绝换取访问令牌：{detail}")
    return cast(str, token)


async def _fetch_google_profile(access_token: str) -> dict[str, str]:
    """拿 Google OpenID userinfo；返回统一 profile dict（`provider_id` 键）。

    userinfo 端点返回 `sub`（稳定用户 id）、`email`、`email_verified`、`name`、`picture`。
    未验证邮箱直接拒绝，避免拿到不可信 email 误关联到他人账号。
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                GOOGLE_API_USERINFO,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.RequestError as e:
        raise OAuthFlowError(
            "OAUTH_NETWORK_ERROR",
            f"无法连接 Google API：{type(e).__name__}",
        ) from e
    if resp.status_code != 200:
        raise OAuthFlowError("OAUTH_PROFILE_FETCH_FAILED", "无法获取 Google 用户信息")
    info = resp.json()
    sub = info.get("sub")
    email = info.get("email")
    # email_verified 可能是 bool 或字符串 "true"
    verified = info.get("email_verified")
    verified_ok = verified is True or str(verified).lower() == "true"
    if not sub:
        raise OAuthFlowError("OAUTH_PROFILE_FETCH_FAILED", "Google 未返回用户标识")
    if not email or not verified_ok:
        raise OAuthFlowError(
            "OAUTH_EMAIL_UNAVAILABLE",
            "Google 账号邮箱不可用或未验证，无法完成登录",
        )
    # 用邮箱前缀兜底 username base；Google name 常含空格/中文不符合 username 规则
    login = str(email).split("@", 1)[0]
    return {
        "provider_id": str(sub),
        "email": str(email).lower(),
        "login": login,
        "avatar_url": str(info.get("picture") or ""),
    }


async def _link_or_create_user(provider: str, profile: dict[str, str], db: AsyncSession) -> User:
    """按 `{provider}_id` → email 顺序查找账号：找到就关联；都没有就新建。

    `provider` ∈ {"github", "google"}，对应 `User.github_id` / `User.google_id` 列。
    """
    id_column = getattr(User, f"{provider}_id")
    id_attr = f"{provider}_id"
    provider_id = profile["provider_id"]
    email = profile["email"]

    # 1) 已按 provider_id 关联的用户
    user = (await db.execute(select(User).where(id_column == provider_id))).scalar_one_or_none()
    if user:
        return user

    # 2) 邮箱已存在但未关联 → 补写 {provider}_id 完成关联
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        setattr(user, id_attr, provider_id)
        # 若原头像为空，用 provider 头像补齐（不覆盖用户自定义头像）
        if not user.avatar_url and profile["avatar_url"]:
            user.avatar_url = profile["avatar_url"]
        await db.commit()
        await db.refresh(user)
        return user

    # 3) 全新用户：邮箱 + provider_id 唯一，hashed_password 保留 NULL
    username = await _pick_available_username(profile["login"], email, db)
    user = User(
        id=uuid.uuid4(),
        email=email,
        username=username,
        hashed_password=None,
        avatar_url=profile["avatar_url"] or None,
    )
    setattr(user, id_attr, provider_id)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _pick_available_username(base: str, email: str, db: AsyncSession) -> str:
    """从 provider 提供的 login 生成本地 username；已存在则递增后缀。

    User 模型要求 2-20 位 [a-zA-Z0-9_中文]，provider login 通常满足前段字符集，
    仅需处理超长和冲突；非法字符先剔除，兜底随机 hex。
    """
    # 剔除 username 不接受的字符（如 Google login 里可能含 '.'）
    cleaned = re.sub(r"[^a-zA-Z0-9_一-鿿]", "", base.strip())
    candidate = cleaned or email.split("@", 1)[0]
    candidate = re.sub(r"[^a-zA-Z0-9_一-鿿]", "", candidate)[:16] or "user"
    # 逐个尝试：候选 / 候选1 / 候选2 …；控制在 20 位以内
    for suffix in ("", *(str(i) for i in range(1, 100))):
        name = (candidate + suffix)[:20]
        exists = (await db.execute(select(User).where(User.username == name))).scalar_one_or_none()
        if not exists:
            return name
    # 极端兜底：随机短 hex，保证唯一
    return f"u_{secrets.token_hex(6)}"


async def complete_github_callback(
    code: str, state: str, db: AsyncSession
) -> tuple[AuthResponse, bool]:
    """GitHub 完整回调：校验 state → 换 token → 拉资料 → 关联/建号 → 签 JWT。

    返回 ``(AuthResponse, is_mobile)``。
    """
    _ensure_configured("github")
    platform = await _verify_state("github", state)
    if platform is None:
        raise OAuthFlowError("OAUTH_STATE_INVALID", "state 参数无效或已过期，请重新发起登录")

    access_token = await _exchange_code_for_token(code)
    profile = await _fetch_github_profile(access_token)
    user = await _link_or_create_user("github", profile, db)

    # 复用 auth_service 的 refresh token 写 Redis 逻辑，避免两处代码分叉
    from app.services.auth_service import build_auth_response

    resp = await build_auth_response(user)
    return resp, platform == "mobile"


async def complete_google_callback(
    code: str, state: str, db: AsyncSession
) -> tuple[AuthResponse, bool]:
    """Google 完整回调：校验 state → 换 token → 拉资料 → 关联/建号 → 签 JWT。

    返回 ``(AuthResponse, is_mobile)``。
    """
    _ensure_configured("google")
    platform = await _verify_state("google", state)
    if platform is None:
        raise OAuthFlowError("OAUTH_STATE_INVALID", "state 参数无效或已过期，请重新发起登录")

    access_token = await _exchange_google_code_for_token(code)
    profile = await _fetch_google_profile(access_token)
    user = await _link_or_create_user("google", profile, db)

    from app.services.auth_service import build_auth_response

    resp = await build_auth_response(user)
    return resp, platform == "mobile"


def build_frontend_redirect(resp: AuthResponse, *, mobile: bool = False) -> str:
    """把 AuthResponse 拼到前端 callback 页面 URL 上，供 302 使用。

    mobile=True 时回 ``yuanai://oauth/callback?...``，供 App deep link 消费。
    """
    params = {
        "access_token": resp.access_token,
        "refresh_token": resp.refresh_token,
        "token_type": resp.token_type,
        "expires_in": str(settings.access_token_expire_minutes * 60),
    }
    qs = urlencode(params)
    if mobile:
        return f"yuanai://oauth/callback?{qs}"
    return f"{settings.web_app_url.rstrip('/')}/oauth/callback?{qs}"


def build_frontend_error_redirect(code: str, message: str, *, mobile: bool = False) -> str:
    """OAuth 失败时的前端跳转，用于统一在 callback 页面弹出错误提示。"""
    params = {"error": code, "error_description": message}
    qs = urlencode(params)
    if mobile:
        return f"yuanai://oauth/callback?{qs}"
    return f"{settings.web_app_url.rstrip('/')}/oauth/callback?{qs}"


__all__ = [
    "OAuthConfigError",
    "OAuthFlowError",
    "build_frontend_error_redirect",
    "build_frontend_redirect",
    "build_github_authorize_url",
    "build_google_authorize_url",
    "complete_github_callback",
    "complete_google_callback",
]
