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
