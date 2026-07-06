"""会话分享 API 集成测试。

覆盖：创建分享 / 查询分享 / 撤销分享 / 匿名访问分享内容 / 有效期 / 密码 / 权限校验。
"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.models.user import User


class TestCreateShareLink:
    async def test_create_share_link(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="分享测试")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        response = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert "shareToken" in data
        assert len(data["shareToken"]) >= 20
        assert data["titleSnapshot"] == "分享测试"
        assert data["hasPassword"] is False
        assert data["expiresAt"] is None

    async def test_create_share_with_password(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="加密分享")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        response = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "secret123"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["hasPassword"] is True

    async def test_create_share_with_expiry(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="限期")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        response = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"expiresInDays": 7},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["expiresAt"] is not None

    async def test_reuse_existing_share_and_update(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="原标题")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        r1 = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={},
            headers=auth_headers,
        )
        token1 = r1.json()["shareToken"]

        # 第二次调用带密码，token 应复用，但 hasPassword 变 True
        r2 = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "abc12345"},
            headers=auth_headers,
        )
        assert r2.json()["shareToken"] == token1
        assert r2.json()["hasPassword"] is True

    async def test_forbidden_when_not_owner(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "他人对话"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        from app.core.security import hash_password

        other = User(
            id=uuid.uuid4(),
            email="other-share@example.com",
            username="other-share",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()

        other_token = create_access_token(str(other.id))
        response = await client.post(
            f"/api/v1/chat/conversations/{conv_id}/share",
            json={},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert response.status_code == 403


class TestGetShareLink:
    async def test_get_existing_share(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="测试")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={},
            headers=auth_headers,
        )
        response = await client.get(
            f"/api/v1/chat/conversations/{conv.id}/share", headers=auth_headers
        )
        assert response.status_code == 200
        assert "shareToken" in response.json()

    async def test_get_nonexistent_share_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="未分享")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        response = await client.get(
            f"/api/v1/chat/conversations/{conv.id}/share", headers=auth_headers
        )
        assert response.status_code == 404


class TestRevokeShareLink:
    async def test_revoke_share(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="待撤销")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        revoke_resp = await client.delete(
            f"/api/v1/chat/conversations/{conv.id}/share", headers=auth_headers
        )
        assert revoke_resp.status_code == 204

        anon_resp = await client.get(f"/api/v1/share/{token}")
        assert anon_resp.status_code == 404


class TestPublicShareRead:
    async def test_anonymous_can_read_shared(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="公开分享")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        msg1 = Message(conv_id=conv.id, role=MessageRole.user, content="你好")
        msg2 = Message(
            conv_id=conv.id, role=MessageRole.assistant, content="你好，有什么可以帮您？"
        )
        db.add_all([msg1, msg2])
        await db.commit()

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        anon_resp = await client.get(f"/api/v1/share/{token}")
        assert anon_resp.status_code == 200
        data = anon_resp.json()
        assert data["title"] == "公开分享"
        assert len(data["messages"]) == 2
        assert data["messages"][0]["content"] == "你好"
        assert data["authorUsername"] == test_user.username

    async def test_anonymous_get_meta(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="有密码")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "abc12345"},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        meta = await client.get(f"/api/v1/share/{token}/meta")
        assert meta.status_code == 200
        data = meta.json()
        assert data["title"] == "有密码"
        assert data["requiresPassword"] is True

    async def test_password_required_returns_403(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="需密码")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "hunter22"},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        anon_resp = await client.get(f"/api/v1/share/{token}")
        assert anon_resp.status_code == 403
        assert anon_resp.json()["detail"]["code"] == "SHARE_PASSWORD_REQUIRED"

    async def test_unlock_with_correct_password(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="解锁测试")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "correct123"},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        unlock_resp = await client.post(
            f"/api/v1/share/{token}/unlock", json={"password": "correct123"}
        )
        assert unlock_resp.status_code == 200
        assert unlock_resp.json()["title"] == "解锁测试"

    async def test_unlock_with_wrong_password(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        test_user: User,
        db: AsyncSession,
    ) -> None:
        conv = Conversation(user_id=test_user.id, model="gpt-4o", title="错密码")
        db.add(conv)
        await db.commit()
        await db.refresh(conv)

        create_resp = await client.post(
            f"/api/v1/chat/conversations/{conv.id}/share",
            json={"password": "right"},
            headers=auth_headers,
        )
        token = create_resp.json()["shareToken"]

        unlock_resp = await client.post(
            f"/api/v1/share/{token}/unlock", json={"password": "wrong"}
        )
        assert unlock_resp.status_code == 403
        assert unlock_resp.json()["detail"]["code"] == "SHARE_PASSWORD_INVALID"

    async def test_invalid_token_404(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/share/invalid-token-xxx")
        assert response.status_code == 404
