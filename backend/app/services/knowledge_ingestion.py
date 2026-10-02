"""知识库文件入库流水线：抓取、解析/OCR、结构感知切块、质量检查与作业记录。

流水线同步跑在请求内：单份文档解析量有界（见 knowledge_parse.MAX_PARSED_CHARS），
换成后台 worker 会多一个必须常驻的进程，而没启动时功能会静默消失。
# ponytail: 单请求内同步入库，出现大文件或批量导入需求时再改成队列 + worker
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File
from app.models.knowledge import (
    IngestionJob,
    IngestionJobStage,
    IngestionJobStatus,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
    KnowledgeSource,
)
from app.services.knowledge_ocr import resolve_ocr_backend
from app.services.knowledge_parse import UnsupportedDocumentError, parse_document
from app.services.knowledge_service import (
    KnowledgeNotFoundError,
    create_document_version,
    readable_base,
    source_in_base,
    writable_base,
)
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

MAX_GARBLED_RATIO = 0.3
MIN_CONTENT_CHARS = 20
MAX_LISTED_JOBS = 100


@dataclass(frozen=True)
class QualityReport:
    """质量检查结论：fatal 非空表示不应入库，warnings 只提示。"""

    fatal: str | None
    warnings: list[str]


def check_quality(blocks: Sequence[tuple[str | None, str]]) -> QualityReport:
    """判断解析结果是否值得入库。

    空内容和整体乱码直接拒绝，避免半成品片段进入检索；轻微乱码和内容过短
    只记告警，由用户决定是否发布。
    """

    text = "".join(content for _, content in blocks)
    stripped = text.strip()
    if not stripped:
        return QualityReport("EMPTY_CONTENT", [])
    garbled_ratio = text.count("�") / len(text)
    if garbled_ratio > MAX_GARBLED_RATIO:
        return QualityReport("GARBLED_CONTENT", [])
    warnings: list[str] = []
    if garbled_ratio > 0:
        warnings.append("PARTIALLY_GARBLED")
    if len(stripped) < MIN_CONTENT_CHARS:
        warnings.append("SHORT_CONTENT")
    return QualityReport(None, warnings)


async def ingest_file(
    *,
    knowledge_base_id: uuid.UUID,
    user_id: uuid.UUID,
    file_id: uuid.UUID,
    name: str | None = None,
    source_uri: str | None = None,
    source_id: uuid.UUID | None = None,
    db: AsyncSession,
) -> IngestionJob:
    """把一个已上传文件走完入库流水线，返回带阶段与错误的作业记录。

    作业本身总会落库：解析失败、格式不支持、OCR 缺失都记录在作业上，而不是
    抛给调用方，调用方据 `status` 判断是否产出了可发布的文档版本。
    """

    await writable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    file = await db.scalar(select(File).where(File.id == file_id, File.user_id == user_id))
    if file is None:
        raise KnowledgeNotFoundError()
    source = (
        None
        if source_id is None
        else await source_in_base(source_id=source_id, knowledge_base_id=knowledge_base_id, db=db)
    )
    job = IngestionJob(
        knowledge_base_id=knowledge_base_id,
        source_id=None if source is None else source.id,
        file_id=file.id,
        status=IngestionJobStatus.running,
        stage=IngestionJobStage.fetch,
        warnings=[],
    )
    db.add(job)
    await db.flush()

    try:
        data = await storage.get_object(file.s3_key)
    except Exception as error:  # 不同存储后端抛不同异常，统一记成可追溯的失败
        logger.warning("入库作业 %s 读取对象存储失败: %s", job.id, error)
        return await _finish(
            job,
            status=IngestionJobStatus.failed,
            code="SOURCE_FETCH_FAILED",
            detail=str(error),
            db=db,
        )

    job.stage = IngestionJobStage.parse
    try:
        parsed = parse_document(data, file.mime_type, file.filename, ocr=resolve_ocr_backend())
    except UnsupportedDocumentError as error:
        logger.warning("入库作业 %s 解析失败: %s", job.id, error)
        return await _finish(
            job,
            status=IngestionJobStatus.failed,
            code="UNSUPPORTED_FORMAT",
            detail=str(error),
            db=db,
        )
    job.parser = parsed.parser
    job.ocr_used = parsed.ocr_used
    blocks = [(block.section, block.content) for block in parsed.blocks]
    job.char_count = sum(len(content) for _, content in blocks)

    job.stage = IngestionJobStage.quality_check
    report = check_quality(blocks)
    warnings = list(report.warnings)
    if parsed.ocr_missing:
        warnings.append("OCR_UNAVAILABLE")
    if report.fatal is not None:
        # OCR 后端缺失导致的无正文是能力降级，不是文档本身有问题：
        # 标成 degraded 让用户装上 ocr extra 后重试，而不是当成成功或彻底失败。
        degraded = parsed.ocr_missing
        return await _finish(
            job,
            status=IngestionJobStatus.degraded if degraded else IngestionJobStatus.failed,
            code="OCR_UNAVAILABLE" if degraded else report.fatal,
            detail=None,
            warnings=warnings,
            db=db,
        )

    job.stage = IngestionJobStage.chunk
    if source is None:
        source = KnowledgeSource(
            knowledge_base_id=knowledge_base_id,
            name=name or file.filename,
            source_type="file",
            source_uri=source_uri,
        )
        db.add(source)
        await db.flush()
        job.source_id = source.id

    job.stage = IngestionJobStage.embed
    try:
        document = await create_document_version(
            source=source, blocks=blocks, parser=parsed.parser, db=db
        )
    except ValueError as error:
        logger.warning("入库作业 %s 归一化后无内容: %s", job.id, error)
        return await _finish(
            job,
            status=IngestionJobStatus.failed,
            code="EMPTY_CONTENT",
            detail=str(error),
            warnings=warnings,
            db=db,
        )
    job.document_id = document.id
    job.chunk_count = (
        await db.scalar(
            select(func.count())
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.document_id == document.id)
        )
        or 0
    )
    if await _duplicates_published(document=document, db=db):
        warnings.append("DUPLICATE_CONTENT")
    return await _finish(
        job,
        status=IngestionJobStatus.degraded if parsed.ocr_missing else IngestionJobStatus.completed,
        warnings=warnings,
        db=db,
    )


async def list_ingestion_jobs(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> list[IngestionJob]:
    """列出当前用户可访问知识库的最近入库作业。"""

    await readable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    result = await db.scalars(
        select(IngestionJob)
        .where(IngestionJob.knowledge_base_id == knowledge_base_id)
        .order_by(IngestionJob.created_at.desc())
        .limit(MAX_LISTED_JOBS)
    )
    return list(result)


async def _finish(
    job: IngestionJob,
    *,
    status: IngestionJobStatus,
    code: str | None = None,
    detail: str | None = None,
    warnings: Sequence[str] | None = None,
    db: AsyncSession,
) -> IngestionJob:
    """写入作业终态，stage 保留在失败发生的那一步。"""

    job.status = status
    job.error_code = code
    job.error_detail = detail
    job.warnings = list(warnings or ())
    job.finished_at = datetime.now(UTC)
    await db.flush()
    return job


async def _duplicates_published(*, document: KnowledgeDocument, db: AsyncSession) -> bool:
    """判断同一来源是否已有内容完全相同的已发布版本。"""

    duplicate = await db.scalar(
        select(
            exists().where(
                KnowledgeDocument.source_id == document.source_id,
                KnowledgeDocument.id != document.id,
                KnowledgeDocument.content_hash == document.content_hash,
                KnowledgeDocument.status == KnowledgeDocumentStatus.published,
            )
        )
    )
    return bool(duplicate)
