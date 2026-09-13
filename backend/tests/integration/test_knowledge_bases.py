"""知识库文本摄取、发布、引用与租户/空间 ACL 集成覆盖。"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models import User


async def _headers_for(db: AsyncSession, *, email: str, username: str) -> dict[str, str]:
    """创建一个独立租户并返回其认证请求头。"""

    user = User(
        id=uuid.uuid4(), email=email, username=username, hashed_password=hash_password("Test1234!")
    )
    db.add(user)
    await db.commit()
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


@pytest.mark.asyncio
async def test_text_source_publishes_atomically_and_returns_source_citations(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """未发布版本不可检索，发布后返回可追溯来源和字符范围。"""

    created = await client.post(
        "/api/v1/knowledge-bases",
        headers=auth_headers,
        json={"name": "Research", "spaceId": str(uuid.uuid4())},
    )
    assert created.status_code == 201
    knowledge_base_id = created.json()["id"]
    staged = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/text",
        headers=auth_headers,
        json={
            "name": "notes.txt",
            "sourceUri": "https://example.test/notes",
            "content": (
                "YuanAI stores source provenance before retrieval.\n\n"
                "Published documents are searchable."
            ),
        },
    )
    assert staged.status_code == 201
    document = staged.json()
    listed_sources = await client.get(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources", headers=auth_headers
    )
    assert listed_sources.status_code == 200
    assert listed_sources.json()[0]["documents"][0]["id"] == document["id"]
    before_publish = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=auth_headers,
        json={"query": "provenance"},
    )
    assert before_publish.json() == []
    source_id = document["sourceId"]
    published = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/{source_id}/documents/{document['id']}/publish",
        headers=auth_headers,
    )
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    search = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=auth_headers,
        json={"query": "provenance"},
    )
    assert search.status_code == 200
    citation = search.json()[0]
    assert citation["sourceId"] == source_id
    assert citation["documentId"] == document["id"]
    assert citation["sourceUri"] == "https://example.test/notes"
    assert citation["charEnd"] > citation["charStart"]
    chinese_source = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/text",
        headers=auth_headers,
        json={"name": "中文资料", "content": "发布后的资料会返回可追溯的来源引用。"},
    )
    assert chinese_source.status_code == 201
    chinese_document = chinese_source.json()
    chinese_published = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/{chinese_document['sourceId']}/documents/"
        f"{chinese_document['id']}/publish",
        headers=auth_headers,
    )
    assert chinese_published.status_code == 200
    chinese_search = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=auth_headers,
        json={"query": "发布后系统会返回什么？"},
    )
    assert chinese_search.status_code == 200
    assert chinese_search.json()[0]["sourceName"] == "中文资料"
    replacement = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/{source_id}/documents/text",
        headers=auth_headers,
        json={"content": "Replacement version has a different searchable term."},
    )
    assert replacement.status_code == 201
    switched = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/{source_id}/documents/"
        f"{replacement.json()['id']}/publish",
        headers=auth_headers,
    )
    assert switched.status_code == 200
    old_result = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=auth_headers,
        json={"query": "provenance"},
    )
    new_result = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=auth_headers,
        json={"query": "replacement"},
    )
    assert old_result.json() == []
    assert new_result.json()[0]["documentVersion"] == 2


@pytest.mark.asyncio
async def test_search_filters_tenant_and_space_acl_before_ranking(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """无成员关系的租户不能发现资料；viewer 可读但不能写。"""

    other_headers = await _headers_for(
        db, email="knowledge-other@example.com", username="knowledge-other"
    )
    created = await client.post(
        "/api/v1/knowledge-bases", headers=auth_headers, json={"name": "Private"}
    )
    knowledge_base_id = created.json()["id"]
    staged = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/text",
        headers=auth_headers,
        json={"name": "private.txt", "content": "tenant isolated unique retrieval phrase"},
    )
    source_id = staged.json()["sourceId"]
    document_id = staged.json()["id"]
    published = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/{source_id}/documents/{document_id}/publish",
        headers=auth_headers,
    )
    assert published.status_code == 200
    hidden = await client.get("/api/v1/knowledge-bases", headers=other_headers)
    assert hidden.json() == []
    blocked_search = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=other_headers,
        json={"query": "unique retrieval phrase"},
    )
    assert blocked_search.status_code == 200
    assert blocked_search.json() == []
    owner = await client.get("/api/v1/auth/me", headers=auth_headers)
    granted = await client.put(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/members",
        headers=auth_headers,
        json={"userId": owner.json()["id"], "role": "viewer"},
    )
    assert granted.status_code == 422
    other = await client.get("/api/v1/auth/me", headers=other_headers)
    granted = await client.put(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/members",
        headers=auth_headers,
        json={"userId": other.json()["id"], "role": "viewer"},
    )
    assert granted.status_code == 200
    allowed_search = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/search",
        headers=other_headers,
        json={"query": "unique retrieval phrase"},
    )
    assert allowed_search.status_code == 200
    assert len(allowed_search.json()) == 1
    write_denied = await client.post(
        f"/api/v1/knowledge-bases/{knowledge_base_id}/sources/text",
        headers=other_headers,
        json={"name": "forbidden.txt", "content": "not allowed"},
    )
    assert write_denied.status_code == 403
