import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from pydantic.alias_generators import to_camel


class RegisterRequest(BaseModel):
    """注册请求。接受 camelCase (verifyCode) 或 snake_case (verify_code) 字段。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    email: EmailStr
    password: str
    username: str
    # 6 位数字邮箱验证码；发送接口为 POST /auth/send-verify-code
    verify_code: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("密码须包含字母和数字")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_一-鿿]{2,20}$", v):
            raise ValueError("用户名 2-20 位，支持中英文、数字、下划线")
        return v

    @field_validator("verify_code")
    @classmethod
    def validate_verify_code(cls, v: str) -> str:
        if not re.match(r"^\d{6}$", v):
            raise ValueError("验证码必须为 6 位数字")
        return v


class SendVerifyCodeRequest(BaseModel):
    """请求发送邮箱验证码。

    scene 决定服务端如何校验邮箱：
    - ``register`` — 邮箱必须未注册（已注册 → 409）
    - ``reset_password`` — 邮箱必须已注册（未注册 → 404）
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    email: EmailStr
    scene: str = "register"

    @field_validator("scene")
    @classmethod
    def validate_scene(cls, v: str) -> str:
        if v not in ("register", "reset_password"):
            raise ValueError("scene 必须为 register 或 reset_password")
        return v


class ResetPasswordRequest(BaseModel):
    """通过邮箱验证码重置密码。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    email: EmailStr
    verify_code: str
    new_password: str

    @field_validator("verify_code")
    @classmethod
    def validate_verify_code(cls, v: str) -> str:
        if not re.match(r"^\d{6}$", v):
            raise ValueError("验证码必须为 6 位数字")
        return v

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("密码须包含字母和数字")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    """序列化为 camelCase，与前端 User 类型对齐"""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: uuid.UUID
    email: str
    username: str
    avatar_url: str | None
    created_at: datetime


class AuthResponse(BaseModel):
    # access_token / refresh_token / token_type 与前端类型保持 snake_case
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class UpdateUserRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    username: str | None = None
    avatar_url: str | None = None


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("密码须包含字母和数字")
        return v


class UserStatsResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    conversation_count: int
    total_tokens: int
    file_count: int
