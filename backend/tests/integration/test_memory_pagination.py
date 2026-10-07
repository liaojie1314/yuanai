"""记忆列表游标分页的稳定性测试。

分页排序键必须不可变：任何普通读写改写了排序键，翻页就会静默漏行。
"""

import base64
import uuid
from datetime import UTC, datetime

import pytest

from app.models.assistant import Assistant


async def _assistant(db, user_id: uuid.UUID) -> Assistant:
    """创建一个默认助理，记忆必须挂在它下面。"""

    assistant = Assistant(
        user_id=user_id,
        name="测试助理1",
        default_model="test-model",
        is_default=True,
    )
    db.add(assistant)
    await db.commit()
    await db.refresh(assistant)
    return assistant


@pytest.mark.asyncio
async def test_memory_list_keeps_every_row_while_a_search_runs_between_pages(
    client, db, test_user, auth_headers
):
    """翻页途中发生检索也不能漏行：排序键必须是普通读写改不动的字段。

    检索会刷新命中记忆的 last_used_at，而 updated_at 带 onupdate。排序键一旦回退成
    updated_at，被顶上去的记忆就插到游标之前，游标已越过的行被挤到其后，第二页直接空掉。
    """

    assistant = await _assistant(db, test_user.id)
    for index in range(4):
        created = await client.post(
            "/api/v1/memories",
            headers=auth_headers,
            json={
                "assistantId": str(assistant.id),
                "memoryType": "preference",
                "content": f"记忆内容{index}",
                "sourceType": "user_input",
                "sourceId": f"msg-{index}",
            },
        )
        assert created.status_code == 201
        confirmed = await client.patch(
            f"/api/v1/memories/{created.json()['id']}",
            headers=auth_headers,
            json={"status": "active"},
        )
        assert confirmed.status_code == 200

    first = (await client.get("/api/v1/memories", headers=auth_headers, params={"limit": 2})).json()
    assert len(first["items"]) == 2

    # 必须确认检索真的命中了全部 4 条，否则本用例会因为"什么都没被改写"而假绿
    search = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(assistant.id), "query": "记忆内容"},
    )
    assert search.status_code == 200
    assert len(search.json()["results"]) == 4

    seen = [item["id"] for item in first["items"]]
    cursor = first["nextCursor"]
    for _ in range(4):
        if cursor is None:
            break
        page = (
            await client.get(
                "/api/v1/memories", headers=auth_headers, params={"limit": 2, "cursor": cursor}
            )
        ).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["nextCursor"]
    assert cursor is None
    assert len(seen) == 4
    assert len(set(seen)) == 4


@pytest.mark.asyncio
async def test_memory_list_rejects_a_cursor_minted_for_the_old_sort_key(client, auth_headers):
    """旧编码的游标按无效输入拒绝，不能被当成 created_at 静默返回错误的一页。"""

    legacy = base64.urlsafe_b64encode(
        f"{datetime.now(UTC).isoformat()}|{uuid.uuid4()}".encode()
    ).decode()
    response = await client.get("/api/v1/memories", headers=auth_headers, params={"cursor": legacy})
    assert response.status_code == 422
