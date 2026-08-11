import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CreateConversationRequest(BaseModel):
    model: str
    title: str = "新对话"


class UpdateConversationRequest(BaseModel):
    """接受 camelCase（前端）或 snake_case（测试/curl）请求体"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    title: str | None = None
    model: str | None = None
    is_pinned: bool | None = None


class ConversationResponse(BaseModel):
    """序列化为 camelCase JSON，与前端 Conversation 类型对齐"""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: uuid.UUID
    title: str
    model: str
    is_pinned: bool
    last_message_at: datetime | None = None
    created_at: datetime


class MessageFileResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    url: str


class MessageResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: uuid.UUID
    role: str
    content: str
    thinking_content: str | None = None
    thinking_duration_ms: int | None = None
    model: str | None = None
    tokens_used: int | None = None
    files: list[MessageFileResponse] = []
    created_at: datetime


class MessageContent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    file_ids: list[uuid.UUID] = []


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    conversation_id: uuid.UUID
    model: str
    message: MessageContent
    enable_thinking: bool = False
    replace_message_id: uuid.UUID | None = None


class TemporaryChatMessage(BaseModel):
    """临时对话客户端上送的单轮历史消息（无 DB 依赖）。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    role: str
    content: str


class TemporaryChatRequest(BaseModel):
    """临时对话流式请求：不持久化任何数据，历史由前端在请求体中维护。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    model: str
    messages: list[TemporaryChatMessage]
    enable_thinking: bool = False


class ShareLinkResponse(BaseModel):
    """会话分享链接信息（返回给分享者本人）"""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    share_token: str
    title_snapshot: str
    created_at: datetime
    expires_at: datetime | None = None
    has_password: bool = False


class CreateShareRequest(BaseModel):
    """创建分享链接的请求；有效期与密码可选"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    # 有效期天数：None/0 表示永久
    expires_in_days: int | None = None
    # 访问密码，为空/None 表示无密码
    password: str | None = None


class UnlockShareRequest(BaseModel):
    """匿名用户校验分享密码"""

    password: str


class SharedConversationResponse(BaseModel):
    """通过分享链接匿名访问时返回的只读会话数据"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    title: str
    model: str
    messages: list[MessageResponse]
    shared_at: datetime
    author_username: str
    expires_at: datetime | None = None


class SharedConversationMetaResponse(BaseModel):
    """未解锁前只暴露标题/作者/是否需要密码，避免暴露内容"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    title: str
    author_username: str
    requires_password: bool
    expires_at: datetime | None = None
    shared_at: datetime
