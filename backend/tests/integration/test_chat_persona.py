"""会话到助理的绑定、重绑与人格对聊天请求的影响。"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.conversation import Conversation
from app.models.user import User
from app.services.assistant_service import resolve_conversation_assistant


@pytest.fixture
async def other_auth_headers(db: AsyncSession) -> dict[str, str]:
    """第二个租户的访问凭据，用于验证重绑不接受别人的助理。"""

    user = User(
        id=uuid.uuid4(),
        email="chat-persona-other@example.com",
        username="chat-other",
        hashed_password="x",
    )
    db.add(user)
    await db.commit()
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


async def _default_assistant_id(client: AsyncClient, headers: dict[str, str]) -> str:
    """取当前用户的默认助理 id（顺带触发懒建）。"""

    response = await client.get("/api/v1/agent/assistants", headers=headers)
    return str(response.json()[0]["id"])


@pytest.mark.asyncio
async def test_conversation_falls_back_to_default_assistant(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """未指定助理的会话在创建时就绑上默认助理，不报错。"""

    created = await client.post(
        "/api/v1/chat/conversations", headers=auth_headers, json={"model": "deepseek-v4-flash"}
    )
    assert created.status_code in (200, 201), created.text
    assert created.json().get("assistantId") is not None


@pytest.mark.asyncio
async def test_create_conversation_rejects_other_users_assistant(
    client: AsyncClient, auth_headers: dict[str, str], other_auth_headers: dict[str, str]
) -> None:
    """创建时指定别人的助理一律 404，不泄漏存在性。"""

    aid = await _default_assistant_id(client, auth_headers)
    created = await client.post(
        "/api/v1/chat/conversations",
        headers=other_auth_headers,
        json={"model": "deepseek-v4-flash", "assistantId": aid},
    )
    assert created.status_code == 404


@pytest.mark.asyncio
async def test_patch_conversation_rebinds_assistant(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """已存在的会话能换绑到自己的另一个助理 —— 侧栏切换器要的就是这个。"""

    first = await _default_assistant_id(client, auth_headers)
    second = (
        await client.post(
            "/api/v1/agent/assistants",
            headers=auth_headers,
            json={"name": "学习搭子", "defaultModel": "deepseek-v4-flash"},
        )
    ).json()["id"]
    cid = (
        await client.post(
            "/api/v1/chat/conversations",
            headers=auth_headers,
            json={"model": "deepseek-v4-flash", "assistantId": first},
        )
    ).json()["id"]

    patched = await client.patch(
        f"/api/v1/chat/conversations/{cid}",
        headers=auth_headers,
        json={"assistantId": second},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["assistantId"] == second


@pytest.mark.asyncio
async def test_patch_conversation_rejects_other_users_assistant(
    client: AsyncClient, auth_headers: dict[str, str], other_auth_headers: dict[str, str]
) -> None:
    """换绑到别人的助理一律 404，不能借会话把助理挪过来。"""

    aid = await _default_assistant_id(client, auth_headers)
    other_conv = await client.post(
        "/api/v1/chat/conversations",
        headers=other_auth_headers,
        json={"model": "deepseek-v4-flash"},
    )
    response = await client.patch(
        f"/api/v1/chat/conversations/{other_conv.json()['id']}",
        headers=other_auth_headers,
        json={"assistantId": aid},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_patch_conversation_can_unbind_assistant(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession, test_user: User
) -> None:
    """显式传 null 解绑，之后聊天按默认助理解析。

    「显式传 null」与「未传该字段」必须区分：后者是「别动它」。
    """

    aid = await _default_assistant_id(client, auth_headers)
    cid = (
        await client.post(
            "/api/v1/chat/conversations",
            headers=auth_headers,
            json={"model": "deepseek-v4-flash", "assistantId": aid},
        )
    ).json()["id"]

    # 未传 assistantId 时不得把绑定抹掉。
    untouched = await client.patch(
        f"/api/v1/chat/conversations/{cid}", headers=auth_headers, json={"title": "换个标题"}
    )
    assert untouched.json()["assistantId"] == aid

    unbound = await client.patch(
        f"/api/v1/chat/conversations/{cid}", headers=auth_headers, json={"assistantId": None}
    )
    assert unbound.status_code == 200, unbound.text
    assert unbound.json()["assistantId"] is None

    conv = await db.scalar(select(Conversation).where(Conversation.id == uuid.UUID(cid)))
    assert conv is not None
    resolved = await resolve_conversation_assistant(conv, user_id=test_user.id, db=db)
    assert str(resolved.id) == aid
    assert conv.assistant_id == resolved.id


@pytest.mark.asyncio
async def test_deleting_assistant_leaves_conversation_usable(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession, test_user: User
) -> None:
    """删掉绑定的助理后会话仍可用：assistant_id 置空并退回现建的默认助理。"""

    aid = await _default_assistant_id(client, auth_headers)
    cid = (
        await client.post(
            "/api/v1/chat/conversations",
            headers=auth_headers,
            json={"model": "deepseek-v4-flash", "assistantId": aid},
        )
    ).json()["id"]
    deleted = await client.delete(f"/api/v1/agent/assistants/{aid}", headers=auth_headers)
    assert deleted.status_code == 204

    conv = await db.scalar(select(Conversation).where(Conversation.id == uuid.UUID(cid)))
    assert conv is not None
    assert conv.assistant_id is None

    # 用户此刻一个助理都不剩，解析必须现建而不是 500。
    resolved = await resolve_conversation_assistant(conv, user_id=test_user.id, db=db)
    assert resolved.id is not None
    assert conv.assistant_id == resolved.id
