"""文件入库流水线的 API 集成覆盖：作业状态、降级、ACL 与引用定位。"""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.knowledge_ingestion as ingestion_service
from app.core.security import create_access_token, hash_password
from app.models import User
from app.services.knowledge_parse import ParsedBlock, ParsedDocument

_MARKDOWN = (
    "# 测试文档1\n\n"
    "本节说明入库流水线会保留标题路径。\n\n"
    "## 引用定位\n\n"
    "发布之后检索结果应当带上所在章节，便于回到原文。\n"
)


async def _upload(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    filename: str,
    content: bytes,
    mime_type: str,
) -> str:
    """上传一个文件并返回其 ID，入库接口只接受已上传文件。"""

    response = await client.post(
        "/api/v1/files/upload",
        headers=headers,
        files={"file": (filename, io.BytesIO(content), mime_type)},
    )
    assert response.status_code == 201
    file_id: str = response.json()["id"]
    return file_id


async def _create_base(client: AsyncClient, headers: dict[str, str]) -> str:
    """创建一个知识库并返回其 ID。"""

    response = await client.post(
        "/api/v1/knowledge-bases", headers=headers, json={"name": "入库测试库"}
    )
    assert response.status_code == 201
    base_id: str = response.json()["id"]
    return base_id


@pytest.mark.asyncio
async def test_markdown_file_ingests_and_citations_keep_section(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Markdown 文件走完流水线后发布，检索引用带回标题路径。"""

    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="测试文档1.md",
        content=_MARKDOWN.encode(),
        mime_type="text/markdown",
    )

    ingested = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={"fileId": file_id},
    )
    assert ingested.status_code == 201
    job = ingested.json()
    assert job["status"] == "completed"
    assert job["stage"] == "embed"
    assert job["parser"] == "markdown"
    assert job["ocrUsed"] is False
    assert job["errorCode"] is None
    assert job["warnings"] == []
    assert job["chunkCount"] == 2
    assert job["documentId"] is not None

    published = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/{job['sourceId']}"
        f"/documents/{job['documentId']}/publish",
        headers=auth_headers,
    )
    assert published.status_code == 200
    assert published.json()["parser"] == "markdown"

    found = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/search",
        headers=auth_headers,
        json={"query": "回到原文"},
    )
    assert found.status_code == 200
    citations = found.json()
    assert citations
    assert citations[0]["section"] == "测试文档1 > 引用定位"
    assert citations[0]["charStart"] < citations[0]["charEnd"]


@pytest.mark.asyncio
async def test_scanned_image_without_ocr_is_degraded_not_failed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """未安装 RapidOCR 时图片入库记为 degraded，不产出文档也不整体失败。"""

    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="扫描件.png",
        content=b"not-a-real-png",
        mime_type="image/png",
    )

    ingested = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={"fileId": file_id},
    )
    assert ingested.status_code == 201
    job = ingested.json()
    assert job["status"] == "degraded"
    assert job["stage"] == "quality_check"
    assert job["errorCode"] == "OCR_UNAVAILABLE"
    assert job["warnings"] == ["OCR_UNAVAILABLE"]
    assert job["documentId"] is None

    listed = await client.get(
        f"/api/v1/knowledge-bases/{base_id}/ingestion-jobs", headers=auth_headers
    )
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [job["id"]]


@pytest.mark.asyncio
async def test_scanned_image_uses_available_ocr_backend(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """OCR 可用时图片正文入库并标记 ocrUsed，测试用假后端不加载真实模型。"""

    monkeypatch.setattr(
        ingestion_service, "resolve_ocr_backend", lambda: lambda _: "扫描件中的合成文字内容"
    )
    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="扫描件.png",
        content=b"not-a-real-png",
        mime_type="image/png",
    )

    ingested = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={"fileId": file_id, "name": "合成扫描件"},
    )
    assert ingested.status_code == 201
    job = ingested.json()
    assert job["status"] == "completed"
    assert job["parser"] == "image"
    assert job["ocrUsed"] is True
    assert job["chunkCount"] == 1


@pytest.mark.asyncio
async def test_partial_ocr_gap_keeps_document_but_marks_degraded(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """部分页面缺 OCR 时仍产出文档版本，但作业标为 degraded 提示内容不完整。"""

    def partial(
        data: bytes, mime_type: str, filename: str, *, ocr: object = None
    ) -> ParsedDocument:
        return ParsedDocument(
            "pdf",
            [ParsedBlock("第 1 页", "有文字层的第一页内容，第二页是没有文字层的扫描图片。")],
            ocr_missing=True,
        )

    monkeypatch.setattr(ingestion_service, "parse_document", partial)
    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="混合扫描.pdf",
        content=b"%PDF-1.4 synthetic",
        mime_type="application/pdf",
    )

    ingested = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={"fileId": file_id},
    )
    assert ingested.status_code == 201
    job = ingested.json()
    assert job["status"] == "degraded"
    assert job["warnings"] == ["OCR_UNAVAILABLE"]
    assert job["errorCode"] is None
    assert job["documentId"] is not None
    assert job["chunkCount"] == 1


@pytest.mark.asyncio
async def test_unsupported_binary_is_recorded_as_failed_job(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """不支持的类型记为失败作业而不是 HTTP 错误，失败文档不产生检索结果。"""

    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="archive.bin",
        content=b"\x00\x01\x02",
        mime_type="application/x-binary",
    )

    ingested = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={"fileId": file_id},
    )
    assert ingested.status_code == 201
    job = ingested.json()
    assert job["status"] == "failed"
    assert job["stage"] == "parse"
    assert job["errorCode"] == "UNSUPPORTED_FORMAT"
    assert job["documentId"] is None
    assert job["sourceId"] is None

    sources = await client.get(f"/api/v1/knowledge-bases/{base_id}/sources", headers=auth_headers)
    assert sources.json() == []


@pytest.mark.asyncio
async def test_reingest_existing_source_adds_a_new_version(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """带 sourceId 重新摄取会给同一来源追加版本，而不是新建来源。"""

    base_id = await _create_base(client, auth_headers)
    first = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={
            "fileId": await _upload(
                client,
                auth_headers,
                filename="制度.md",
                content=b"# A\n\nfirst revision of the synthetic policy document\n",
                mime_type="text/markdown",
            )
        },
    )
    source_id = first.json()["sourceId"]

    second = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=auth_headers,
        json={
            "fileId": await _upload(
                client,
                auth_headers,
                filename="制度.md",
                content=b"# A\n\nsecond revision of the synthetic policy document\n",
                mime_type="text/markdown",
            ),
            "sourceId": source_id,
        },
    )
    assert second.status_code == 201
    assert second.json()["sourceId"] == source_id

    sources = await client.get(f"/api/v1/knowledge-bases/{base_id}/sources", headers=auth_headers)
    body = sources.json()
    assert len(body) == 1
    assert [document["version"] for document in body[0]["documents"]] == [2, 1]


@pytest.mark.asyncio
async def test_ingest_rejects_other_tenant_base_and_file(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """跨租户的知识库和跨用户的文件都不可入库。"""

    base_id = await _create_base(client, auth_headers)
    file_id = await _upload(
        client,
        auth_headers,
        filename="测试文档1.md",
        content=_MARKDOWN.encode(),
        mime_type="text/markdown",
    )
    other = User(
        id=uuid.uuid4(),
        email="other-ingest@example.com",
        username="other-ingest",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(other)
    await db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}

    forbidden = await client.post(
        f"/api/v1/knowledge-bases/{base_id}/sources/file",
        headers=other_headers,
        json={"fileId": file_id},
    )
    assert forbidden.status_code == 404

    other_base_id = await _create_base(client, other_headers)
    stolen = await client.post(
        f"/api/v1/knowledge-bases/{other_base_id}/sources/file",
        headers=other_headers,
        json={"fileId": file_id},
    )
    assert stolen.status_code == 404
    assert stolen.json()["detail"] == "KNOWLEDGE_INGEST_TARGET_NOT_FOUND"
