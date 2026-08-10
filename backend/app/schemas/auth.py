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
        if v not in ("register", "reset_password", "change_email"):
            raise ValueError("scene 必须为 register/reset_password/change_email")
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


class DesktopOAuthExchangeRequest(BaseModel):
    """桌面端 OAuth 一次性授权码交换请求。"""

    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", v):
            raise ValueError("OAuth 授权码无效")
        return v


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
    bio: str | None = None
    password_changed_at: datetime | None = None
    github_id: str | None = None
    google_id: str | None = None
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
    bio: str | None = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not re.match(r"^[a-zA-Z0-9_一-鿿]{2,20}$", v):
            raise ValueError("用户名 2-20 位，支持中英文、数字、下划线")
        return v

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 200:
            raise ValueError("简介不能超过 200 字")
        return v


class ChangeEmailRequest(BaseModel):
    """修改邮箱：新邮箱 + 发送到新邮箱的验证码。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    new_email: EmailStr
    verify_code: str

    @field_validator("verify_code")
    @classmethod
    def validate_verify_code(cls, v: str) -> str:
        if not re.match(r"^\d{6}$", v):
            raise ValueError("验证码必须为 6 位数字")
        return v


class UserPreferencesResponse(BaseModel):
    """用户偏好设置响应体"""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    theme: str
    font_size: str
    density: str
    time_format: str
    date_format: str
    language: str


class UpdatePreferencesRequest(BaseModel):
    """任意子集偏好更新（未提供的字段保持不变）"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    theme: str | None = None
    font_size: str | None = None
    density: str | None = None
    time_format: str | None = None
    date_format: str | None = None
    language: str | None = None

    @field_validator("theme")
    @classmethod
    def _theme(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in ("auto", "light", "dark"):
            raise ValueError("theme 必须为 auto/light/dark")
        return v

    @field_validator("font_size")
    @classmethod
    def _font_size(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in ("small", "medium", "large"):
            raise ValueError("fontSize 必须为 small/medium/large")
        return v

    @field_validator("density")
    @classmethod
    def _density(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in ("compact", "standard", "loose"):
            raise ValueError("density 必须为 compact/standard/loose")
        return v

    @field_validator("time_format")
    @classmethod
    def _time_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in ("24h", "12h"):
            raise ValueError("timeFormat 必须为 24h/12h")
        return v

    @field_validator("date_format")
    @classmethod
    def _date_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in ("ymd", "mdy", "dmy"):
            raise ValueError("dateFormat 必须为 ymd/mdy/dmy")
        return v


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
