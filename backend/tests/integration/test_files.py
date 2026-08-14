"""文件上传 API 集成测试 —— 覆盖直传 / 秒传 / 分片 / 断点续传 / 取消。

测试环境的 ``STORAGE_BACKEND=local``，走 LocalStorageService，无需 MinIO。
"""

from __future__ import annotations

import hashlib
import io
import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.file import File
from app.models.upload_session import FileUploadSession
from app.models.user import User


def _hash(data: bytes) -> str:
    """SHA-256 十六进制字符串，与前端 crypto.subtle.digest 结果一致。"""
    return hashlib.sha256(data).hexdigest()


class TestDirectUpload:
    async def test_upload_small_file(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ) -> None:
        content = b"hello yuanai" * 100
        response = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("hello.txt", io.BytesIO(content), "text/plain")},
            data={"file_hash": _hash(content)},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["filename"] == "hello.txt"
        assert body["sizeBytes"] == len(content)
        assert body["mimeType"] == "text/plain"
        assert body["fileHash"] == _hash(content)
        assert body["url"].startswith("http")

    async def test_upload_without_hash(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        content = b"no hash"
        response = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("plain.bin", io.BytesIO(content), "application/octet-stream")},
        )
        assert response.status_code == 201
        assert response.json()["fileHash"] is None

    async def test_upload_too_large(
        self, client: AsyncClient, auth_headers: dict[str, str], monkeypatch
    ) -> None:
        # 临时把直传上限调到 100 字节
        from app.api.v1 import files as files_mod

        monkeypatch.setattr(files_mod.settings, "max_direct_upload_bytes", 100)

        content = b"x" * 200
        response = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("big.bin", io.BytesIO(content), "application/octet-stream")},
        )
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == "FILE_TOO_LARGE"

    async def test_upload_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/files/upload",
            files={"file": ("x.txt", io.BytesIO(b"y"), "text/plain")},
        )
        assert response.status_code == 401

    async def test_preview_uploaded_text_file(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        upload = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("preview.txt", io.BytesIO(b"preview content"), "text/plain")},
        )
        assert upload.status_code == 201
        response = await client.get(
            f"/api/v1/files/{upload.json()['id']}/preview", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["kind"] == "text"
        assert response.json()["text"] == "preview content"

    async def test_download_returns_attachment_response(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        upload = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("中文 note.txt", io.BytesIO(b"download content"), "text/plain")},
        )
        assert upload.status_code == 201

        response = await client.get(
            f"/api/v1/files/{upload.json()['id']}/download", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.content == b"download content"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert "UTF-8%20note.txt" in response.headers["content-disposition"]


class TestCheckHash:
    async def test_check_hash_miss(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post(
            "/api/v1/files/check-hash",
            headers=auth_headers,
            json={"fileHash": _hash(b"nope")},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "FILE_NOT_FOUND"

    async def test_check_hash_hit_secondary_upload(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ) -> None:
        content = b"once uploaded, second is instant"
        # 先上传一次
        first = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("dup.txt", io.BytesIO(content), "text/plain")},
            data={"file_hash": _hash(content)},
        )
        assert first.status_code == 201
        original_id = first.json()["id"]

        # 秒传检查应命中
        response = await client.post(
            "/api/v1/files/check-hash",
            headers=auth_headers,
            json={"fileHash": _hash(content)},
        )
        assert response.status_code == 200
        assert response.json()["id"] == original_id

    async def test_check_hash_isolated_per_user(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
    ) -> None:
        # 另一个用户上传同 hash 的文件，本用户 check-hash 不能命中他人
        other = User(
            id=uuid.uuid4(),
            email="other-files@example.com",
            username="other_files",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()
        other_token = create_access_token(str(other.id))
        other_headers = {"Authorization": f"Bearer {other_token}"}

        content = b"private"
        await client.post(
            "/api/v1/files/upload",
            headers=other_headers,
            files={"file": ("x.bin", io.BytesIO(content), "application/octet-stream")},
            data={"file_hash": _hash(content)},
        )

        response = await client.post(
            "/api/v1/files/check-hash",
            headers=auth_headers,
            json={"fileHash": _hash(content)},
        )
        assert response.status_code == 404


class TestChunkedUpload:
    async def _create_session(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        *,
        filename: str = "big.bin",
        size_bytes: int = 12 * 1024 * 1024,
        total_chunks: int = 3,
        file_hash: str | None = None,
    ) -> dict:
        response = await client.post(
            "/api/v1/files/upload-session",
            headers=auth_headers,
            json={
                "filename": filename,
                "mimeType": "application/octet-stream",
                "sizeBytes": size_bytes,
                "totalChunks": total_chunks,
                "fileHash": file_hash,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def test_create_session(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        session = await self._create_session(client, auth_headers)
        assert "sessionId" in session
        assert session["uploadedChunks"] == []
        assert session["totalChunks"] == 3
        assert session["chunkSize"] > 0

    async def test_create_session_rejects_zero_chunks(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post(
            "/api/v1/files/upload-session",
            headers=auth_headers,
            json={
                "filename": "a",
                "mimeType": "x/y",
                "sizeBytes": 1,
                "totalChunks": 0,
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INVALID_TOTAL_CHUNKS"

    async def test_create_session_is_idempotent_by_hash(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        h = _hash(b"my file content marker")
        first = await self._create_session(
            client, auth_headers, filename="x.bin", file_hash=h
        )
        second = await self._create_session(
            client, auth_headers, filename="x.bin", file_hash=h
        )
        # 同一 hash / 同一元数据 → 返回同一 sessionId
        assert first["sessionId"] == second["sessionId"]

    async def test_get_session_returns_state(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        session = await self._create_session(client, auth_headers)
        resp = await client.get(
            f"/api/v1/files/upload-session/{session['sessionId']}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["sessionId"] == session["sessionId"]

    async def test_get_session_forbidden_for_other_user(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
    ) -> None:
        session = await self._create_session(client, auth_headers)

        other = User(
            id=uuid.uuid4(),
            email="another@example.com",
            username="another",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()
        other_headers = {
            "Authorization": f"Bearer {create_access_token(str(other.id))}"
        }
        resp = await client.get(
            f"/api/v1/files/upload-session/{session['sessionId']}",
            headers=other_headers,
        )
        assert resp.status_code == 403

    async def test_upload_chunk_and_progress(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        # 每片 5 MB（LocalStorageService 无 S3 最小分片限制，可用小分片测）
        session = await self._create_session(
            client, auth_headers, size_bytes=15, total_chunks=3
        )
        for idx, chunk in enumerate([b"aaaaa", b"bbbbb", b"ccccc"]):
            resp = await client.put(
                f"/api/v1/files/upload-session/{session['sessionId']}/chunk/{idx}",
                headers=auth_headers,
                files={"chunk": (f"part-{idx}", io.BytesIO(chunk), "application/octet-stream")},
            )
            assert resp.status_code == 200
            assert idx in resp.json()["uploaded"]

    async def test_chunk_index_out_of_range(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        session = await self._create_session(client, auth_headers, total_chunks=3)
        resp = await client.put(
            f"/api/v1/files/upload-session/{session['sessionId']}/chunk/9",
            headers=auth_headers,
            files={"chunk": ("p", io.BytesIO(b"x"), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_CHUNK_INDEX"

    async def test_complete_merges_all_chunks(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        parts = [b"first-part", b"second-part", b"final-part"]
        total_bytes = sum(len(p) for p in parts)
        session = await self._create_session(
            client, auth_headers, size_bytes=total_bytes, total_chunks=len(parts)
        )
        for idx, chunk in enumerate(parts):
            resp = await client.put(
                f"/api/v1/files/upload-session/{session['sessionId']}/chunk/{idx}",
                headers=auth_headers,
                files={"chunk": (f"c{idx}", io.BytesIO(chunk), "application/octet-stream")},
            )
            assert resp.status_code == 200

        resp = await client.post(
            f"/api/v1/files/upload-session/{session['sessionId']}/complete",
            headers=auth_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["sizeBytes"] == total_bytes
        assert body["url"].startswith("http")

    async def test_complete_fails_if_chunks_missing(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        session = await self._create_session(client, auth_headers, total_chunks=3)
        # 只上传其中 1 片
        await client.put(
            f"/api/v1/files/upload-session/{session['sessionId']}/chunk/0",
            headers=auth_headers,
            files={"chunk": ("p", io.BytesIO(b"only-one"), "application/octet-stream")},
        )
        resp = await client.post(
            f"/api/v1/files/upload-session/{session['sessionId']}/complete",
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "CHUNKS_INCOMPLETE"

    async def test_resume_reuses_previous_chunks(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """模拟前端 tab 崩溃 → 重新调 create-session 后应拿到既有 session + 已上传分片。"""
        h = _hash(b"resume-marker")
        session = await self._create_session(
            client, auth_headers, filename="r.bin", total_chunks=3, file_hash=h
        )
        # 传前 2 片
        for idx, data in enumerate([b"aa", b"bb"]):
            await client.put(
                f"/api/v1/files/upload-session/{session['sessionId']}/chunk/{idx}",
                headers=auth_headers,
                files={"chunk": (f"p{idx}", io.BytesIO(data), "application/octet-stream")},
            )

        # 重新 create → 幂等命中同一 session
        again = await self._create_session(
            client, auth_headers, filename="r.bin", total_chunks=3, file_hash=h
        )
        assert again["sessionId"] == session["sessionId"]
        assert set(again["uploadedChunks"]) == {0, 1}

    async def test_abort_session(
        self, client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
    ) -> None:
        session = await self._create_session(client, auth_headers)
        resp = await client.delete(
            f"/api/v1/files/upload-session/{session['sessionId']}",
            headers=auth_headers,
        )
        assert resp.status_code == 204

        # 状态应变为 aborted
        from sqlalchemy import select

        row = await db.execute(
            select(FileUploadSession).where(
                FileUploadSession.id == uuid.UUID(session["sessionId"])
            )
        )
        record = row.scalar_one()
        assert record.status == "aborted"


class TestUploadIsolation:
    async def test_chunk_upload_forbidden_for_other_user(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
    ) -> None:
        session_resp = await client.post(
            "/api/v1/files/upload-session",
            headers=auth_headers,
            json={
                "filename": "x.bin",
                "mimeType": "application/octet-stream",
                "sizeBytes": 100,
                "totalChunks": 2,
            },
        )
        assert session_resp.status_code == 201
        session_id = session_resp.json()["sessionId"]

        # 另一个用户尝试上传分片 → 403
        other = User(
            id=uuid.uuid4(),
            email="intruder@example.com",
            username="intruder",
            hashed_password=hash_password("Test1234!"),
        )
        db.add(other)
        await db.commit()
        other_headers = {
            "Authorization": f"Bearer {create_access_token(str(other.id))}"
        }
        resp = await client.put(
            f"/api/v1/files/upload-session/{session_id}/chunk/0",
            headers=other_headers,
            files={"chunk": ("p", io.BytesIO(b"x"), "application/octet-stream")},
        )
        assert resp.status_code == 403


class TestFileModel:
    async def test_file_row_created_on_upload(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db: AsyncSession,
        test_user: User,
    ) -> None:
        content = b"persistence check"
        response = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("p.bin", io.BytesIO(content), "application/octet-stream")},
            data={"file_hash": _hash(content)},
        )
        assert response.status_code == 201

        from sqlalchemy import select

        row = await db.execute(select(File).where(File.user_id == test_user.id))
        rows = row.scalars().all()
        assert len(rows) == 1
        assert rows[0].size_bytes == len(content)
        assert rows[0].file_hash == _hash(content)
