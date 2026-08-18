"""设置页面相关 API 集成测试：修改用户名/邮箱/偏好、清空会话。"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.user import User


class TestUpdateProfile:
    async def test_update_username(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me",
            json={"username": "new_name_2026"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["username"] == "new_name_2026"

    async def test_update_bio(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        response = await client.patch(
            "/api/v1/auth/me",
            json={"bio": "热爱开源"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["bio"] == "热爱开源"

    async def test_username_conflict(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
        test_user: User,
    ) -> None:
        import uuid as _uuid

        from app.core.security import hash_password

        other = User(
            id=_uuid.uuid4(),
            email="taken@example.com",
            username="taken_user",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()

        response = await client.patch(
            "/api/v1/auth/me",
            json={"username": "taken_user"},
            headers=auth_headers,
        )
        assert response.status_code == 409

    async def test_bio_too_long(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        response = await client.patch(
            "/api/v1/auth/me",
            json={"bio": "x" * 201},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestUpdatePreferences:
    async def test_get_default_preferences(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/api/v1/auth/me/preferences", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["theme"] == "auto"
        assert data["fontSize"] == "medium"
        assert data["density"] == "standard"
        assert data["timeFormat"] == "24h"
        assert data["dateFormat"] == "ymd"
        assert data["language"] == "zh-CN"

    async def test_update_preferences_partial(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/preferences",
            json={"theme": "dark", "fontSize": "large"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["theme"] == "dark"
        assert data["fontSize"] == "large"
        # 未指定的字段保持默认
        assert data["density"] == "standard"

    async def test_invalid_theme_value(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/preferences",
            json={"theme": "rainbow"},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestChangeEmail:
    async def test_change_email_with_debug_code(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ) -> None:
        # 测试环境 VERIFY_CODE_DEBUG_BYPASS=888888
        response = await client.patch(
            "/api/v1/auth/me/email",
            json={"newEmail": "new@example.com", "verifyCode": "888888"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["email"] == "new@example.com"

    async def test_change_email_taken(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
    ) -> None:
        import uuid as _uuid

        from app.core.security import hash_password

        other = User(
            id=_uuid.uuid4(),
            email="occupied@example.com",
            username="occupied",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()

        response = await client.patch(
            "/api/v1/auth/me/email",
            json={"newEmail": "occupied@example.com", "verifyCode": "888888"},
            headers=auth_headers,
        )
        assert response.status_code == 409

    async def test_change_email_invalid_code(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/email",
            json={"newEmail": "another@example.com", "verifyCode": "000000"},
            headers=auth_headers,
        )
        assert response.status_code == 400


class TestClearAllConversations:
    async def test_clear_all_conversations(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        # 建 3 个会话
        for i in range(3):
            db.add(Conversation(user_id=test_user.id, model="gpt-4o", title=f"待清空 {i}"))
        await db.commit()

        list_resp = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert len(list_resp.json()["conversations"]) == 3

        del_resp = await client.delete("/api/v1/chat/conversations", headers=auth_headers)
        assert del_resp.status_code == 200
        assert del_resp.json()["deleted"] == 3

        list_after = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert list_after.json()["conversations"] == []

    async def test_clear_only_affects_owner(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        import uuid as _uuid

        from app.core.security import hash_password

        other = User(
            id=_uuid.uuid4(),
            email="other-clear@example.com",
            username="other-clear",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()

        db.add(Conversation(user_id=test_user.id, model="gpt-4o", title="mine"))
        db.add(Conversation(user_id=other.id, model="gpt-4o", title="other"))
        await db.commit()

        del_resp = await client.delete("/api/v1/chat/conversations", headers=auth_headers)
        assert del_resp.status_code == 200
        assert del_resp.json()["deleted"] == 1

        # 确认另一个用户的对话仍在
        from sqlalchemy import select

        remaining = await db.execute(select(Conversation).where(Conversation.user_id == other.id))
        assert len(remaining.scalars().all()) == 1
