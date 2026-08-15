"""扫码登录的 API 请求与响应契约。"""

import re
from datetime import datetime
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel


def validate_qr_login_api_base_url(value: str) -> str:
    """校验二维码中的 API 地址仅指向受支持的生产或局域网开发端点。"""
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path != "/api/v1"
    ):
        raise ValueError("二维码 API 地址无效")

    try:
        _ = parsed.port
    except ValueError as error:
        raise ValueError("二维码 API 地址端口无效") from error

    hostname = parsed.hostname
    if hostname is None:
        raise ValueError("二维码 API 地址主机无效")
    if parsed.scheme == "https" or _is_local_or_private_host(hostname):
        return parsed.geturl()
    raise ValueError("非局域网 API 地址必须使用 HTTPS")


def _is_local_or_private_host(hostname: str) -> bool:
    """判断 HTTP 开发地址是否是 loopback 或私有局域网 IP。"""
    if hostname.lower() == "localhost":
        return True
    try:
        address = ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


class QRLoginCreateRequest(BaseModel):
    """目标设备创建二维码挑战时提交的公开设备信息。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    target_platform: Literal["web", "desktop"]
    device_name: str
    api_base_url: str | None = None

    @field_validator("device_name")
    @classmethod
    def validate_device_name(cls, value: str) -> str:
        """限制用于移动端确认页的设备名称。"""
        normalized = value.strip()
        if not normalized or len(normalized) > 120:
            raise ValueError("设备名称长度必须在 1 到 120 个字符之间")
        return normalized

    @field_validator("api_base_url")
    @classmethod
    def validate_api_base_url(cls, value: str | None) -> str | None:
        """阻止目标端将移动用户的认证请求重定向到不安全地址。"""
        if value is None:
            return None
        return validate_qr_login_api_base_url(value)


class QRLoginCreateResponse(BaseModel):
    """仅向发起目标设备返回的挑战和轮询凭据。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    challenge: str
    poll_secret: str
    qr_data_uri: str
    expires_at: datetime
    poll_after_ms: int


QRLoginStatus = Literal["pending", "approved", "denied", "consumed", "expired"]
QRLoginTargetPlatform = Literal["web", "desktop"]


class QRLoginStatusResponse(BaseModel):
    """目标设备轮询二维码挑战时可见的最小状态。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: QRLoginStatus
    expires_at: datetime
    authorization_code: str | None = None


class QRLoginInspectResponse(BaseModel):
    """已登录手机在确认前可查看的目标设备摘要。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    target_platform: QRLoginTargetPlatform
    device_name: str
    expires_at: datetime
    status: QRLoginStatus


class QRLoginExchangeRequest(BaseModel):
    """目标设备使用一次性授权码换取常规登录会话。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    challenge: str
    poll_secret: str
    authorization_code: str

    @field_validator("challenge", "poll_secret", "authorization_code")
    @classmethod
    def validate_secret_shape(cls, value: str) -> str:
        """拒绝非 URL-safe 的异常凭据，避免无效请求进入数据库查询。"""
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", value):
            raise ValueError("扫码登录凭据无效")
        return value
