"""Web Push 订阅相关 Pydantic schema。

请求体对齐浏览器 `PushSubscription.toJSON()` 的结构：
`{ endpoint, expirationTime, keys: { p256dh, auth } }`。
"""

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class PushSubscriptionKeys(BaseModel):
    """浏览器订阅公钥对。"""

    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    """前端上报的 Web Push 订阅（浏览器 PushSubscription 序列化结果）。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    endpoint: str = Field(min_length=1, max_length=1000)
    keys: PushSubscriptionKeys


class UnsubscribeRequest(BaseModel):
    """按 endpoint 退订。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    endpoint: str = Field(min_length=1, max_length=1000)


class VapidPublicKeyResponse(BaseModel):
    """暴露给前端的 VAPID 公钥；未配置时 publicKey 为空串。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    public_key: str


class SubscriptionResultResponse(BaseModel):
    """订阅/退订结果。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    ok: bool
