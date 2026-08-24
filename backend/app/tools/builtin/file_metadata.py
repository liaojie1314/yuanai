"""只读上传文件元数据工具。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.models.file import File
from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

FILE_METADATA_SPEC = ToolSpec(
    name="inspect_uploaded_file_metadata",
    description="查看当前用户已上传文件的非敏感元数据，不读取文件内容。",
    input_schema={
        "type": "object",
        "properties": {"file_id": {"type": "string", "minLength": 1, "maxLength": 36}},
        "required": ["file_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "file_id": {"type": "string"},
            "filename": {"type": "string"},
            "mime_type": {"type": "string"},
            "size_bytes": {"type": "integer"},
            "file_hash": {"type": ["string", "null"]},
            "created_at": {"type": ["string", "null"]},
        },
        "required": ["file_id", "filename", "mime_type", "size_bytes"],
    },
    risk_level=ToolRisk.read,
    execution_location="cloud",
    timeout_seconds=5,
    idempotent=True,
)


def _created_at(value: datetime | None) -> str | None:
    """将数据库时间转为稳定字符串。"""

    return value.isoformat() if value is not None else None


async def inspect_uploaded_file_metadata(
    arguments: dict[str, object], context: ToolContext
) -> ToolOutput:
    """按 user_id 查询文件元数据，永不返回存储 key 或文件内容。"""

    if context.db is None or context.user_id is None:
        raise ToolError(ToolErrorCode.FILE_CONTEXT_REQUIRED)
    file_id_value = arguments.get("file_id")
    if not isinstance(file_id_value, str):
        raise ToolError(ToolErrorCode.FILE_NOT_FOUND)
    try:
        file_id = uuid.UUID(file_id_value)
    except ValueError as error:
        raise ToolError(ToolErrorCode.FILE_NOT_FOUND) from error

    try:
        result = await context.db.execute(
            select(File).where(File.id == file_id, File.user_id == context.user_id)
        )
    except SQLAlchemyError as error:
        raise ToolError(ToolErrorCode.EXECUTION_FAILED) from error
    file = result.scalar_one_or_none()
    if file is None:
        raise ToolError(ToolErrorCode.FILE_NOT_FOUND)
    return {
        "file_id": str(file.id),
        "filename": file.filename,
        "mime_type": file.mime_type,
        "size_bytes": file.size_bytes,
        "file_hash": file.file_hash,
        "created_at": _created_at(file.created_at),
    }
