"""知识库文本摄取、ACL 检索与发布事务。"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseMember,
    KnowledgeBaseMemberRole,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
    KnowledgeSource,
)
from app.schemas.knowledge import KnowledgeCitation, KnowledgeTextSourceCreate
from app.services.memory_retrieval import maybe_embed_text

MAX_CHUNK_CHARS = 1_000
_TOKEN_PATTERN = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


class KnowledgeNotFoundError(Exception):
    """资源不存在或当前租户不可见。"""


class KnowledgePermissionError(Exception):
    """可见成员尝试执行超出 ACL 的写操作。"""


def normalize_text(content: str) -> str:
    """归一化 Unicode 与空白，保持段落边界用于可追溯切块。"""

    normalized = unicodedata.normalize("NFKC", content).replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [" ".join(part.split()) for part in normalized.split("\n\n")]
    return "\n\n".join(part for part in paragraphs if part).strip()


def chunk_text(content: str, max_chars: int = MAX_CHUNK_CHARS) -> list[tuple[str, int, int]]:
    """按段落优先、按字符兜底切分归一化文本并记录原文范围。"""

    chunks: list[tuple[str, int, int]] = []
    cursor = 0
    for paragraph in content.split("\n\n"):
        start = content.find(paragraph, cursor)
        cursor = start + len(paragraph)
        for offset in range(0, len(paragraph), max_chars):
            chunk = paragraph[offset : offset + max_chars]
            chunks.append((chunk, start + offset, start + offset + len(chunk)))
    return chunks


def knowledge_base_access_predicate(user_id: uuid.UUID) -> ColumnElement[bool]:
    """定义所有检索查询复用的租户与空间 ACL 谓词。"""

    membership = exists(
        select(KnowledgeBaseMember.id).where(
            KnowledgeBaseMember.knowledge_base_id == KnowledgeBase.id,
            KnowledgeBaseMember.user_id == user_id,
        )
    )
    return or_(KnowledgeBase.owner_id == user_id, membership)


async def create_knowledge_base(
    *, owner_id: uuid.UUID, name: str, space_id: uuid.UUID | None, db: AsyncSession
) -> KnowledgeBase:
    """创建当前租户拥有的知识库。"""

    knowledge_base = KnowledgeBase(owner_id=owner_id, name=name, space_id=space_id)
    db.add(knowledge_base)
    await db.flush()
    return knowledge_base


async def list_knowledge_bases(*, user_id: uuid.UUID, db: AsyncSession) -> list[KnowledgeBase]:
    """列出用户作为所有者或空间成员可访问的知识库。"""

    result = await db.scalars(
        select(KnowledgeBase)
        .where(knowledge_base_access_predicate(user_id))
        .order_by(KnowledgeBase.updated_at.desc())
    )
    return list(result)


async def list_knowledge_sources(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> list[KnowledgeSource]:
    """列出可访问知识库的来源及其版本，供发布控制恢复状态。"""

    await _readable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    result = await db.scalars(
        select(KnowledgeSource)
        .options(selectinload(KnowledgeSource.documents))
        .where(KnowledgeSource.knowledge_base_id == knowledge_base_id)
        .order_by(KnowledgeSource.created_at.desc())
    )
    return list(result.unique())


async def grant_member(
    *,
    knowledge_base_id: uuid.UUID,
    owner_id: uuid.UUID,
    user_id: uuid.UUID,
    role: KnowledgeBaseMemberRole,
    db: AsyncSession,
) -> KnowledgeBaseMember:
    """由所有者更新空间 ACL；所有者自身始终由所有权访问。"""

    knowledge_base = await _owned_base(knowledge_base_id=knowledge_base_id, user_id=owner_id, db=db)
    if user_id == knowledge_base.owner_id:
        raise KnowledgePermissionError("所有者不需要成员授权")
    member = await db.scalar(
        select(KnowledgeBaseMember).where(
            KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
            KnowledgeBaseMember.user_id == user_id,
        )
    )
    if member is None:
        member = KnowledgeBaseMember(
            knowledge_base_id=knowledge_base.id, user_id=user_id, role=role
        )
        db.add(member)
    else:
        member.role = role
    await db.flush()
    return member


async def create_text_source(
    *,
    knowledge_base_id: uuid.UUID,
    user_id: uuid.UUID,
    request: KnowledgeTextSourceCreate,
    db: AsyncSession,
) -> tuple[KnowledgeSource, KnowledgeDocument]:
    """创建纯文本来源及其首个暂存版本，尚不对检索公开。"""

    await _writable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    source = KnowledgeSource(
        knowledge_base_id=knowledge_base_id,
        name=request.name,
        source_type="text",
        source_uri=request.source_uri,
    )
    db.add(source)
    await db.flush()
    document = await _create_document(source=source, content=request.content, db=db)
    return source, document


async def create_text_version(
    *,
    knowledge_base_id: uuid.UUID,
    source_id: uuid.UUID,
    user_id: uuid.UUID,
    content: str,
    db: AsyncSession,
) -> KnowledgeDocument:
    """为已有来源构建一个待发布版本。"""

    await _writable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    source = await _source_in_base(source_id=source_id, knowledge_base_id=knowledge_base_id, db=db)
    return await _create_document(source=source, content=content, db=db)


async def publish_document(
    *,
    knowledge_base_id: uuid.UUID,
    source_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> KnowledgeDocument:
    """在一个事务内切换来源版本，失败时保持原已发布版本不变。"""

    await _writable_base(knowledge_base_id=knowledge_base_id, user_id=user_id, db=db)
    source = await db.scalar(
        select(KnowledgeSource)
        .where(
            KnowledgeSource.id == source_id, KnowledgeSource.knowledge_base_id == knowledge_base_id
        )
        .with_for_update()
    )
    if source is None:
        raise KnowledgeNotFoundError()
    document = await db.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.source_id == source.id,
            KnowledgeDocument.status == KnowledgeDocumentStatus.staged,
        )
    )
    if document is None:
        raise KnowledgeNotFoundError()
    published = list(
        (
            await db.scalars(
                select(KnowledgeDocument)
                .where(
                    KnowledgeDocument.source_id == source.id,
                    KnowledgeDocument.status == KnowledgeDocumentStatus.published,
                )
                .with_for_update()
            )
        ).all()
    )
    for previous in published:
        previous.status = KnowledgeDocumentStatus.superseded
    document.status = KnowledgeDocumentStatus.published
    document.published_at = datetime.now(UTC)
    await db.flush()
    return document


async def search_knowledge(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, query: str, limit: int, db: AsyncSession
) -> list[KnowledgeCitation]:
    """先在 SQL 中应用租户和空间 ACL，再对允许片段进行 FTS/向量排序。"""

    return await _search_knowledge(
        knowledge_base_id=knowledge_base_id, user_id=user_id, query=query, limit=limit, db=db
    )


async def search_accessible_knowledge(
    *, user_id: uuid.UUID, query: str, limit: int, db: AsyncSession
) -> list[KnowledgeCitation]:
    """跨当前用户可访问的知识库检索，用于 Agent 上下文组装。"""

    return await _search_knowledge(
        knowledge_base_id=None, user_id=user_id, query=query, limit=limit, db=db
    )


async def _search_knowledge(
    *,
    knowledge_base_id: uuid.UUID | None,
    user_id: uuid.UUID,
    query: str,
    limit: int,
    db: AsyncSession,
) -> list[KnowledgeCitation]:
    """在 ACL 过滤后的有界候选集内融合关键词与可用向量分数。"""

    if limit < 1:
        return []
    query_embedding = await maybe_embed_text(query)
    fts_query = func.plainto_tsquery("simple", query)
    fts_match = KnowledgeChunk.search_vector.op("@@")(fts_query)
    candidates_query = (
        select(KnowledgeChunk, KnowledgeDocument, KnowledgeSource)
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .join(KnowledgeSource, KnowledgeDocument.source_id == KnowledgeSource.id)
        .join(KnowledgeBase, KnowledgeSource.knowledge_base_id == KnowledgeBase.id)
        .where(
            knowledge_base_access_predicate(user_id),
            KnowledgeDocument.status == KnowledgeDocumentStatus.published,
        )
    )
    if knowledge_base_id is not None:
        candidates_query = candidates_query.where(KnowledgeBase.id == knowledge_base_id)
    if query_embedding is None:
        keyword_matches = [
            KnowledgeChunk.content.ilike(f"%{term}%") for term in _terms(query) if len(term) > 1
        ]
        candidates_query = candidates_query.where(
            or_(fts_match, KnowledgeChunk.content.ilike(f"%{query}%"), *keyword_matches)
        )
    candidates = list(
        (
            await db.execute(
                candidates_query.order_by(KnowledgeChunk.created_at.desc()).limit(
                    min(limit * 20, 400)
                )
            )
        ).all()
    )
    terms = _terms(query)
    ranked = sorted(
        (
            (
                _score(chunk.content, chunk.embedding, terms, query_embedding),
                chunk,
                document,
                source,
            )
            for chunk, document, source in candidates
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    return [
        KnowledgeCitation(
            knowledge_base_id=source.knowledge_base_id,
            source_id=source.id,
            document_id=document.id,
            source_name=source.name,
            source_uri=source.source_uri,
            document_version=document.version,
            chunk_index=chunk.chunk_index,
            section=chunk.section,
            char_start=chunk.char_start,
            char_end=chunk.char_end,
            content=chunk.content,
            score=score,
        )
        for score, chunk, document, source in ranked[:limit]
        if score > 0
    ]


async def _create_document(
    *, source: KnowledgeSource, content: str, db: AsyncSession
) -> KnowledgeDocument:
    """归一化、切块并为一个来源构建待发布版本。"""

    normalized = normalize_text(content)
    if not normalized:
        raise ValueError("知识库文本归一化后为空")
    version = (
        await db.scalar(
            select(func.max(KnowledgeDocument.version)).where(
                KnowledgeDocument.source_id == source.id
            )
        )
        or 0
    ) + 1
    document = KnowledgeDocument(
        source_id=source.id,
        version=version,
        content_hash=hashlib.sha256(normalized.encode()).hexdigest(),
        normalized_content=normalized,
        status=KnowledgeDocumentStatus.staged,
    )
    db.add(document)
    await db.flush()
    for index, (chunk, char_start, char_end) in enumerate(chunk_text(normalized)):
        db.add(
            KnowledgeChunk(
                document_id=document.id,
                chunk_index=index,
                content=chunk,
                char_start=char_start,
                char_end=char_end,
                embedding=await maybe_embed_text(chunk),
            )
        )
    await db.flush()
    return document


async def _owned_base(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> KnowledgeBase:
    """返回当前用户拥有的知识库，不泄露其他租户 ID。"""

    knowledge_base = await db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == knowledge_base_id,
            KnowledgeBase.owner_id == user_id,
        )
    )
    if knowledge_base is None:
        raise KnowledgeNotFoundError()
    return knowledge_base


async def _readable_base(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> KnowledgeBase:
    """返回用户通过所有权或成员关系可访问的知识库。"""

    knowledge_base = await db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == knowledge_base_id,
            knowledge_base_access_predicate(user_id),
        )
    )
    if knowledge_base is None:
        raise KnowledgeNotFoundError()
    return knowledge_base


async def _writable_base(
    *, knowledge_base_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> KnowledgeBase:
    """返回所有者或 editor 成员可写的知识库。"""

    knowledge_base = await db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == knowledge_base_id,
            knowledge_base_access_predicate(user_id),
        )
    )
    if knowledge_base is None:
        raise KnowledgeNotFoundError()
    if knowledge_base.owner_id == user_id:
        return knowledge_base
    member = await db.scalar(
        select(KnowledgeBaseMember).where(
            KnowledgeBaseMember.knowledge_base_id == knowledge_base.id,
            KnowledgeBaseMember.user_id == user_id,
        )
    )
    if member is None or member.role != KnowledgeBaseMemberRole.editor:
        raise KnowledgePermissionError()
    return knowledge_base


async def _source_in_base(
    *, source_id: uuid.UUID, knowledge_base_id: uuid.UUID, db: AsyncSession
) -> KnowledgeSource:
    """将来源限定在调用路径给定的知识库内。"""

    source = await db.scalar(
        select(KnowledgeSource).where(
            KnowledgeSource.id == source_id,
            KnowledgeSource.knowledge_base_id == knowledge_base_id,
        )
    )
    if source is None:
        raise KnowledgeNotFoundError()
    return source


def _terms(value: str) -> set[str]:
    """为 CJK 和空格分词文本生成轻量关键词集合。"""

    words = set(_TOKEN_PATTERN.findall(value.lower()))
    cjk_characters = [
        character for word in words for character in word if "\u4e00" <= character <= "\u9fff"
    ]
    cjk_bigrams = {
        "".join(cjk_characters[index : index + 2]) for index in range(len(cjk_characters) - 1)
    }
    return words | set(cjk_characters) | cjk_bigrams


def _score(
    content: str,
    embedding: Sequence[float] | None,
    terms: set[str],
    query_embedding: Sequence[float] | None,
) -> float:
    """合并关键词重叠和可用的余弦向量分数。"""

    keyword_score = len(_terms(content) & terms) / max(len(terms), 1)
    vector_score = _cosine_similarity(query_embedding, embedding)
    return (keyword_score + vector_score) / 2 if vector_score is not None else keyword_score


def _cosine_similarity(left: Sequence[float] | None, right: Sequence[float] | None) -> float | None:
    """计算同维向量余弦值，异常或缺失向量不进入语义排序。"""

    if left is None or right is None or len(left) != len(right) or not left:
        return None
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    denominator = math.sqrt(sum(a * a for a in left)) * math.sqrt(sum(b * b for b in right))
    return numerator / denominator if denominator else None
