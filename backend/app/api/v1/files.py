"""文件上传 API — 秒传 / 直传 / 分片断点续传，全部走对象存储桶。

数据流：
- **直传**（≤ ``max_direct_upload_bytes``）：前端 POST 表单，后端一次性 ``put_object`` 到桶。
- **分片**（> 阈值）：前端先 ``POST /files/upload-session`` 拿到 sessionId + s3 upload_id；
  逐片 ``PUT /files/upload-session/{sid}/chunk/{i}``，后端把 body 转发到
  ``s3.upload_part`` 并把 ETag 记入 session；最后 ``POST /complete`` 触发
  ``s3.complete_multipart_upload`` 合并对象、落库 ``File``。
- **秒传**：POST ``/files/check-hash`` 校验 hash → 命中返回既有 File；未命中 404。
- **断点**：前端在同一 hash 上再次 POST ``/files/upload-session`` 会拿到既有的 pending 会话
  （find-or-create 幂等）；GET ``/files/upload-session/{sid}`` 拉回已上传分片列表继续上传。
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.models.file import File
from app.models.upload_session import FileUploadSession
from app.services.storage_service import storage

router = APIRouter(prefix="/files", tags=["files"])

SESSION_TTL_HOURS = 24


# ── 响应 Schema ───────────────────────────────────────────────────────────────


class FileResponse(BaseModel):
    """单个文件的序列化视图。"""

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
    file_hash: str | None = None
    created_at: datetime


class UploadSessionResponse(BaseModel):
    """分片上传会话创建 / 进度响应。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    session_id: uuid.UUID
    uploaded_chunks: list[int]
    total_chunks: int
    chunk_size: int
    expires_at: datetime


# ── 请求 Schema ───────────────────────────────────────────────────────────────


class CheckHashRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    file_hash: str


class CreateUploadSessionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    filename: str
    mime_type: str
    size_bytes: int
    total_chunks: int
    file_hash: str | None = None


# ── 辅助函数 ──────────────────────────────────────────────────────────────────


def _ext_from_filename(filename: str) -> str:
    """从文件名提取扩展名（不含点），无扩展名时返回空串。"""
    parts = filename.rsplit(".", 1)
    return parts[1] if len(parts) == 2 else ""


def _build_object_key(user_id: uuid.UUID, filename: str) -> str:
    """生成对象存储 key：``files/{user_id}/{uuid}.{ext}``。"""
    ext = _ext_from_filename(filename)
    file_id = uuid.uuid4()
    return f"files/{user_id}/{file_id}.{ext}" if ext else f"files/{user_id}/{file_id}"


def _build_file_response(file: File) -> FileResponse:
    """将 File ORM 对象转为 FileResponse，URL 通过 storage 计算。"""
    return FileResponse(
        id=file.id,
        filename=file.filename,
        mime_type=file.mime_type,
        size_bytes=file.size_bytes,
        url=storage.get_url(file.s3_key),
        file_hash=file.file_hash,
        created_at=file.created_at,
    )


def _session_response(session: FileUploadSession) -> UploadSessionResponse:
    return UploadSessionResponse(
        session_id=session.id,
        uploaded_chunks=sorted(session.uploaded_chunks or []),
        total_chunks=session.total_chunks,
        chunk_size=settings.upload_chunk_size_bytes,
        expires_at=session.expires_at,
    )


def _is_expired(session: FileUploadSession) -> bool:
    return datetime.now(UTC) > session.expires_at


# ── 端点 ──────────────────────────────────────────────────────────────────────


@router.post("/check-hash", response_model=FileResponse)
async def check_hash(
    req: CheckHashRequest, current_user: CurrentUser, db: DB
) -> FileResponse:
    """秒传：若当前用户已上传过相同 hash 的文件，直接返回既有记录。"""
    result = await db.execute(
        select(File).where(
            File.file_hash == req.file_hash,
            File.user_id == current_user.id,
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(
            404, {"code": "FILE_NOT_FOUND", "message": "未找到匹配的文件"}
        )
    return _build_file_response(file)


@router.post("/upload", response_model=FileResponse, status_code=201)
async def upload_file(
    file: UploadFile,
    current_user: CurrentUser,
    db: DB,
    file_hash: str | None = Form(default=None),
) -> FileResponse:
    """直接上传（≤ ``max_direct_upload_bytes``）。超限时提示切换分片上传。"""
    content = await file.read()
    if len(content) > settings.max_direct_upload_bytes:
        raise HTTPException(
            413,
            {
                "code": "FILE_TOO_LARGE",
                "message": (
                    f"直传文件不能超过 {settings.max_direct_upload_bytes // (1024 * 1024)} MB，"
                    "请使用分片上传"
                ),
            },
        )

    filename = file.filename or "upload"
    content_type = file.content_type or "application/octet-stream"
    key = _build_object_key(current_user.id, filename)
    await storage.put_object(key, content, content_type)

    db_file = File(
        user_id=current_user.id,
        filename=filename,
        mime_type=content_type,
        size_bytes=len(content),
        s3_key=key,
        file_hash=file_hash,
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)
    return _build_file_response(db_file)


@router.post("/upload-session", response_model=UploadSessionResponse, status_code=201)
async def create_upload_session(
    req: CreateUploadSessionRequest, current_user: CurrentUser, db: DB
) -> UploadSessionResponse:
    """创建（或复用）分片上传会话 — 幂等：同用户同 hash 的未过期 pending 会话直接返回。"""
    if req.size_bytes > settings.max_upload_size_bytes:
        raise HTTPException(
            413,
            {
                "code": "FILE_TOO_LARGE",
                "message": (
                    f"文件大小超过上限 "
                    f"{settings.max_upload_size_bytes // (1024 * 1024)} MB"
                ),
            },
        )
    if req.total_chunks < 1:
        raise HTTPException(
            400, {"code": "INVALID_TOTAL_CHUNKS", "message": "total_chunks 必须 ≥ 1"}
        )

    # find-or-create：命中相同 hash 的活跃会话则复用（断点续传的关键）
    if req.file_hash:
        existing = await db.execute(
            select(FileUploadSession).where(
                FileUploadSession.user_id == current_user.id,
                FileUploadSession.file_hash == req.file_hash,
                FileUploadSession.status == "pending",
            )
        )
        session = existing.scalar_one_or_none()
        if session and not _is_expired(session):
            # 元数据必须一致，防止用户误用同 hash 上传不同文件（极小概率）
            if (
                session.size_bytes == req.size_bytes
                and session.total_chunks == req.total_chunks
            ):
                return _session_response(session)
            # 元数据不一致：中止旧会话，重新创建
            if session.s3_upload_id and session.s3_key:
                await storage.abort_multipart(session.s3_key, session.s3_upload_id)
            session.status = "aborted"
            await db.commit()

    # 新建：先生成 S3 multipart upload_id，再落库
    key = _build_object_key(current_user.id, req.filename)
    upload_id = await storage.create_multipart(key, req.mime_type)

    session = FileUploadSession(
        user_id=current_user.id,
        filename=req.filename,
        mime_type=req.mime_type,
        size_bytes=req.size_bytes,
        total_chunks=req.total_chunks,
        uploaded_chunks=[],
        file_hash=req.file_hash,
        s3_upload_id=upload_id,
        s3_key=key,
        s3_parts=[],
        status="pending",
        expires_at=datetime.now(UTC) + timedelta(hours=SESSION_TTL_HOURS),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_response(session)


@router.get("/upload-session/{session_id}", response_model=UploadSessionResponse)
async def get_upload_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> UploadSessionResponse:
    """查询分片上传会话状态 — 前端在恢复上传时先调此接口拿已上传分片列表。"""
    session = await _load_session(session_id, current_user, db)
    return _session_response(session)


@router.put("/upload-session/{session_id}/chunk/{chunk_index}")
async def upload_chunk(
    session_id: uuid.UUID,
    chunk_index: int,
    chunk: UploadFile,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """上传单个分片 — body 直接转发到 ``s3.upload_part``，仅在内存中短暂持有。"""
    session = await _load_session(session_id, current_user, db)
    if session.status != "pending":
        raise HTTPException(
            400, {"code": "SESSION_NOT_PENDING", "message": "会话已完成或已中止"}
        )
    if _is_expired(session):
        raise HTTPException(
            410, {"code": "SESSION_EXPIRED", "message": "会话已过期，请重新创建"}
        )
    if chunk_index < 0 or chunk_index >= session.total_chunks:
        raise HTTPException(
            400, {"code": "INVALID_CHUNK_INDEX", "message": "分片序号超出范围"}
        )
    if not session.s3_upload_id or not session.s3_key:
        raise HTTPException(
            500, {"code": "SESSION_CORRUPT", "message": "会话缺少存储 upload_id"}
        )

    data = await chunk.read()
    if not data:
        raise HTTPException(400, {"code": "EMPTY_CHUNK", "message": "分片内容为空"})

    # S3 分片编号从 1 开始
    part_number = chunk_index + 1
    etag = await storage.upload_part(
        session.s3_key, session.s3_upload_id, part_number, data
    )

    # 幂等：若客户端重传同一个分片，覆盖既有 ETag 记录
    uploaded: list[int] = list(session.uploaded_chunks or [])
    parts: list[dict] = list(session.s3_parts or [])
    parts = [p for p in parts if int(p["PartNumber"]) != part_number]
    parts.append({"PartNumber": part_number, "ETag": etag})
    if chunk_index not in uploaded:
        uploaded.append(chunk_index)
    session.uploaded_chunks = sorted(uploaded)
    session.s3_parts = sorted(parts, key=lambda p: int(p["PartNumber"]))
    await db.commit()
    return {"uploaded": session.uploaded_chunks, "chunkIndex": chunk_index}


@router.post(
    "/upload-session/{session_id}/complete",
    response_model=FileResponse,
    status_code=201,
)
async def complete_upload_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> FileResponse:
    """通知后端所有分片已上传，触发 S3 合并并落库 File。"""
    session = await _load_session(session_id, current_user, db)
    if session.status != "pending":
        raise HTTPException(
            400, {"code": "SESSION_NOT_PENDING", "message": "会话已完成或已中止"}
        )
    if _is_expired(session):
        raise HTTPException(
            410, {"code": "SESSION_EXPIRED", "message": "会话已过期，请重新上传"}
        )
    if not session.s3_upload_id or not session.s3_key:
        raise HTTPException(
            500, {"code": "SESSION_CORRUPT", "message": "会话缺少存储 upload_id"}
        )

    uploaded = sorted(session.uploaded_chunks or [])
    expected = list(range(session.total_chunks))
    if uploaded != expected:
        missing = sorted(set(expected) - set(uploaded))
        raise HTTPException(
            400,
            {
                "code": "CHUNKS_INCOMPLETE",
                "message": f"分片未全部上传，缺少: {missing}",
            },
        )

    # 触发 S3 合并
    await storage.complete_multipart(
        session.s3_key, session.s3_upload_id, list(session.s3_parts or [])
    )

    db_file = File(
        user_id=current_user.id,
        filename=session.filename,
        mime_type=session.mime_type,
        size_bytes=session.size_bytes,
        s3_key=session.s3_key,
        file_hash=session.file_hash,
    )
    db.add(db_file)
    session.status = "completed"
    await db.commit()
    await db.refresh(db_file)
    return _build_file_response(db_file)


@router.delete("/upload-session/{session_id}", status_code=204)
async def abort_upload_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """中止分片上传 — 用户取消或前端不再需要该会话时调用，同时清理 S3 已上传分片。"""
    session = await _load_session(session_id, current_user, db)
    if session.status == "pending" and session.s3_upload_id and session.s3_key:
        await storage.abort_multipart(session.s3_key, session.s3_upload_id)
    session.status = "aborted"
    await db.commit()


# ── 会话加载与权限校验 ────────────────────────────────────────────────────────


async def _load_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> FileUploadSession:
    result = await db.execute(
        select(FileUploadSession).where(FileUploadSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(
            404, {"code": "SESSION_NOT_FOUND", "message": "上传会话不存在"}
        )
    if session.user_id != current_user.id:
        raise HTTPException(
            403, {"code": "FORBIDDEN", "message": "无权访问此会话"}
        )
    return session
