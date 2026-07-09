import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    ChangeEmailRequest,
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SendVerifyCodeRequest,
    UpdatePreferencesRequest,
    UpdateUserRequest,
    UserPreferencesResponse,
    UserResponse,
    UserStatsResponse,
)
from app.services import auth_service, oauth_service, verify_code_service
from app.services.oauth_service import OAuthConfigError, OAuthFlowError
from app.services.verify_code_service import Scene, VerifyCodeError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/send-verify-code", status_code=200)
async def send_verify_code(req: SendVerifyCodeRequest, db: DB) -> dict[str, str]:
    """发送邮箱验证码到指定邮箱。

    - ``register`` 场景：邮箱必须**未**注册，已注册 → 409
    - ``reset_password`` 场景：邮箱必须**已**注册，未注册 → 404
    - 频率限制：同邮箱同场景 60 秒内只能发一次（返回 429）
    """
    scene: Scene = req.scene  # type: ignore[assignment]
    existing = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()

    if scene == "register" and existing:
        raise HTTPException(
            409,
            {"code": "EMAIL_ALREADY_REGISTERED", "message": "该邮箱已被注册，请直接登录"},
        )
    if scene == "reset_password" and not existing:
        raise HTTPException(
            404,
            {"code": "EMAIL_NOT_FOUND", "message": "该邮箱尚未注册"},
        )
    if scene == "change_email" and existing:
        raise HTTPException(
            409,
            {"code": "EMAIL_ALREADY_REGISTERED", "message": "该邮箱已被其他账户使用"},
        )

    try:
        await verify_code_service.send_code(req.email, scene=scene)
    except VerifyCodeError as e:
        status = 429 if e.code == "VERIFY_CODE_THROTTLED" else 500
        raise HTTPException(status, {"code": e.code, "message": e.message}) from e

    return {"message": "验证码已发送"}


@router.post("/reset-password", status_code=200)
async def reset_password(req: ResetPasswordRequest, db: DB) -> dict[str, str]:
    """通过邮箱验证码重置密码。"""
    try:
        await auth_service.reset_password(req, db)
    except VerifyCodeError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message}) from e
    except ValueError as e:
        if str(e) == "EMAIL_NOT_FOUND":
            raise HTTPException(404, {"code": "EMAIL_NOT_FOUND", "message": "该邮箱尚未注册"}) from e
        raise HTTPException(500, {"code": "INTERNAL_ERROR", "message": "密码重置失败"}) from e
    return {"message": "密码已重置"}


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: DB) -> AuthResponse:
    try:
        return await auth_service.register(req, db)
    except VerifyCodeError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message}) from e
    except ValueError as e:
        code = str(e)
        if code == "EMAIL_OR_USERNAME_EXISTS":
            raise HTTPException(409, {"code": code, "message": "邮箱或用户名已被注册"}) from e
        raise HTTPException(500, {"code": "INTERNAL_ERROR", "message": "注册失败"}) from e


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: DB) -> AuthResponse:
    try:
        return await auth_service.login(req.email, req.password, db)
    except ValueError as e:
        raise HTTPException(
            401, {"code": "AUTH_INVALID_CREDENTIALS", "message": "邮箱或密码错误"}
        ) from e


@router.post("/refresh")
async def refresh(req: RefreshRequest) -> dict[str, str]:
    try:
        access_token = await auth_service.refresh_token(req.refresh_token)
        return {"access_token": access_token, "token_type": "bearer"}
    except ValueError as e:
        raise HTTPException(
            401, {"code": "AUTH_TOKEN_INVALID", "message": "Refresh token 无效"}
        ) from e


@router.post("/logout", status_code=200)
async def logout(current_user: CurrentUser) -> dict[str, str]:
    await auth_service.logout(current_user.id)
    return {"message": "已退出登录"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(req: UpdateUserRequest, current_user: CurrentUser, db: DB) -> UserResponse:
    if req.username is not None:
        # 唯一性检查
        exists = await db.execute(
            select(User).where(User.username == req.username).where(User.id != current_user.id)
        )
        if exists.scalar_one_or_none():
            raise HTTPException(
                409, {"code": "USERNAME_TAKEN", "message": "该用户名已被使用"}
            )
        current_user.username = req.username
    if req.avatar_url is not None:
        current_user.avatar_url = req.avatar_url
    if req.bio is not None:
        current_user.bio = req.bio
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.patch("/me/email", response_model=UserResponse)
async def change_email(
    req: ChangeEmailRequest, current_user: CurrentUser, db: DB
) -> UserResponse:
    """修改当前用户邮箱。需要先通过 send-verify-code(scene=change_email) 发码。"""
    # 邮箱唯一性检查
    existing = await db.execute(
        select(User).where(User.email == req.new_email).where(User.id != current_user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            409, {"code": "EMAIL_ALREADY_REGISTERED", "message": "该邮箱已被其他账户使用"}
        )

    try:
        await verify_code_service.verify_code(req.new_email, req.verify_code, scene="change_email")
    except VerifyCodeError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message}) from e

    current_user.email = req.new_email
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.get("/me/preferences", response_model=UserPreferencesResponse)
async def get_my_preferences(current_user: CurrentUser) -> UserPreferencesResponse:
    return UserPreferencesResponse.model_validate(current_user)


@router.patch("/me/preferences", response_model=UserPreferencesResponse)
async def update_my_preferences(
    req: UpdatePreferencesRequest, current_user: CurrentUser, db: DB
) -> UserPreferencesResponse:
    if req.theme is not None:
        current_user.theme = req.theme
    if req.font_size is not None:
        current_user.font_size = req.font_size
    if req.density is not None:
        current_user.density = req.density
    if req.time_format is not None:
        current_user.time_format = req.time_format
    if req.date_format is not None:
        current_user.date_format = req.date_format
    if req.language is not None:
        current_user.language = req.language
    await db.commit()
    await db.refresh(current_user)
    return UserPreferencesResponse.model_validate(current_user)


@router.get("/me/stats", response_model=UserStatsResponse)
async def get_my_stats(current_user: CurrentUser, db: DB) -> UserStatsResponse:
    return await auth_service.get_stats(current_user.id, db)


@router.patch("/me/password", status_code=200)
async def change_password(
    req: ChangePasswordRequest, current_user: CurrentUser, db: DB
) -> dict[str, str]:
    try:
        await auth_service.change_password(current_user, req.old_password, req.new_password, db)
    except ValueError as e:
        if str(e) == "OLD_PASSWORD_WRONG":
            raise HTTPException(400, {"code": "OLD_PASSWORD_WRONG", "message": "当前密码不正确"}) from e
        raise HTTPException(500, {"code": "INTERNAL_ERROR", "message": "修改密码失败"}) from e
    current_user.password_changed_at = datetime.now(UTC)
    await db.commit()
    return {"message": "密码已修改"}


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(file: UploadFile, current_user: CurrentUser, db: DB) -> UserResponse:
    """上传用户头像，支持 jpeg/png/webp/gif，最大 5 MB。"""
    from app.services.storage_service import storage

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            400, {"code": "INVALID_FILE_TYPE", "message": "仅支持上传图片文件"}
        )

    _EXT_MAP = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    ext = _EXT_MAP.get(file.content_type, "jpg")

    content = await file.read()
    max_size = 5 * 1024 * 1024
    if len(content) > max_size:
        raise HTTPException(
            413, {"code": "FILE_TOO_LARGE", "message": "头像文件不能超过 5 MB"}
        )

    key = f"avatars/{current_user.id}/{uuid.uuid4()}.{ext}"
    url = await storage.put_object(key, content, file.content_type)
    current_user.avatar_url = url
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.delete("/me", status_code=200)
async def delete_me(current_user: CurrentUser, db: DB) -> dict[str, str]:
    await auth_service.delete_account(current_user, db)
    return {"message": "账号已注销"}


# ── GitHub OAuth ─────────────────────────────────────────────
@router.get("/github")
async def github_authorize() -> RedirectResponse:
    """302 到 GitHub 授权页；state 写入 Redis 供 callback 校验。"""
    try:
        url = await oauth_service.build_github_authorize_url()
    except OAuthConfigError as e:
        raise HTTPException(
            503, {"code": "OAUTH_NOT_CONFIGURED", "message": str(e)}
        ) from e
    return RedirectResponse(url, status_code=302)


@router.get("/github/callback")
async def github_callback(
    db: DB,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> RedirectResponse:
    """GitHub 回调：exchange code → 创建/关联用户 → 带 token 跳回前端。

    任何失败都以 `error` / `error_description` 参数回跳前端 callback 页面，
    由前端统一渲染成 toast，不在此处返回 JSON（避免用户看到裸 500 页面）。
    """
    if error:
        return RedirectResponse(
            oauth_service.build_frontend_error_redirect(
                "OAUTH_PROVIDER_ERROR", error_description or error
            ),
            status_code=302,
        )
    if not code or not state:
        return RedirectResponse(
            oauth_service.build_frontend_error_redirect(
                "OAUTH_MISSING_PARAMS", "回调缺少 code 或 state 参数"
            ),
            status_code=302,
        )
    try:
        resp = await oauth_service.complete_github_callback(code, state, db)
    except OAuthConfigError as e:
        return RedirectResponse(
            oauth_service.build_frontend_error_redirect("OAUTH_NOT_CONFIGURED", str(e)),
            status_code=302,
        )
    except OAuthFlowError as e:
        return RedirectResponse(
            oauth_service.build_frontend_error_redirect(e.code, e.message),
            status_code=302,
        )
    return RedirectResponse(oauth_service.build_frontend_redirect(resp), status_code=302)
