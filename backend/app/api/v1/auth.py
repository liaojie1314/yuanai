from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, DB
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    UpdateUserRequest,
    UserResponse,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: DB) -> AuthResponse:
    try:
        return await auth_service.register(req, db)
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
        current_user.username = req.username
    if req.avatar_url is not None:
        current_user.avatar_url = req.avatar_url
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)
