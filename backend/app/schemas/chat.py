import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateConversationRequest(BaseModel):
    model: str
    title: str = "新对话"


class UpdateConversationRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    is_pinned: bool | None = None


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    model: str
    is_pinned: bool
    last_message_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageFileResponse(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    url: str

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    model: str | None = None
    tokens_used: int | None = None
    files: list[MessageFileResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageContent(BaseModel):
    content: str
    file_ids: list[uuid.UUID] = []


class SendMessageRequest(BaseModel):
    conversation_id: uuid.UUID
    model: str
    message: MessageContent
