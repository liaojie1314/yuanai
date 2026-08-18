"""对象存储服务 — 生产环境走 S3/MinIO，测试环境走本地文件系统。

统一暴露 ``storage`` 单例，根据 ``settings.storage_backend`` 选择实现。
两种实现都支持 S3 多段上传语义（create_multipart / upload_part / complete /
abort），使得 files.py 的分片上传流程无需感知底层存储。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Protocol

import aiofiles
import boto3
from botocore.exceptions import ClientError

from app.core.config import settings

# 允许匿名 GET 的对象前缀 —— 头像永远公开，聊天附件在 MVP 阶段也公开以简化展示；
# 未来接入分享/私有文件流程时可改为签名 URL。
_PUBLIC_READ_PREFIXES = ("avatars/*", "files/*", "generated/*")


class StorageService(Protocol):
    """抽象存储接口 — S3 与本地实现共同遵循的最小契约。"""

    async def put_object(self, key: str, data: bytes, content_type: str) -> str:
        """一次性写入对象（用于小文件、头像、直传）。返回公开 URL。"""

    async def get_object(self, key: str) -> bytes:
        """读取对象内容，用于受限的文件预览和 AI 上下文提取。"""

    async def create_multipart(self, key: str, content_type: str) -> str:
        """创建多段上传会话，返回后端存储的 upload_id。"""

    async def upload_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        """上传单个分片（part_number 从 1 开始）。返回该分片的 ETag。"""

    async def complete_multipart(
        self, key: str, upload_id: str, parts: list[dict[str, Any]]
    ) -> str:
        """合并所有分片。parts 为 [{"PartNumber": int, "ETag": str}, ...]。返回公开 URL。"""

    async def abort_multipart(self, key: str, upload_id: str) -> None:
        """终止多段上传并清理已上传分片。"""

    async def delete(self, key: str) -> None:
        """删除对象（不存在时静默忽略）。"""

    def get_url(self, key: str) -> str:
        """返回对象的公开访问 URL（不访问后端存储）。"""


# ── S3 / MinIO 实现 ───────────────────────────────────────────────────────────


class S3StorageService:
    """基于 boto3 的 S3 兼容对象存储（AWS S3 / MinIO / 阿里云 OSS 等）。

    所有 boto3 调用是同步 API，用 ``asyncio.to_thread`` 包装以避免阻塞事件循环。
    单例复用同一个 boto3 client，boto3 内部有连接池。
    """

    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name="us-east-1",  # MinIO 忽略此字段，AWS 需要
        )
        self.bucket = settings.s3_bucket_name
        self.public_url = settings.s3_public_url

    async def ensure_bucket(self) -> None:
        """启动时确保 bucket 存在，并授予匿名 GET 权限（MinIO 默认私有）。

        MinIO / AWS S3 的 bucket 默认拒绝匿名读，导致 ``<img src="…/avatars/…">``
        返回 ``AccessDenied``。这里 head → create → put_bucket_policy，
        允许 ``_PUBLIC_READ_PREFIXES`` 下的对象被公开访问。
        """
        try:
            await asyncio.to_thread(self._client.head_bucket, Bucket=self.bucket)
        except ClientError:
            await asyncio.to_thread(self._client.create_bucket, Bucket=self.bucket)

        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AllowPublicReadOnUserFiles",
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [
                        f"arn:aws:s3:::{self.bucket}/{prefix}" for prefix in _PUBLIC_READ_PREFIXES
                    ],
                }
            ],
        }
        try:
            await asyncio.to_thread(
                self._client.put_bucket_policy,
                Bucket=self.bucket,
                Policy=json.dumps(policy),
            )
        except ClientError:
            # 权限不足或后端不支持 bucket policy —— 不阻断启动，稍后由运维手动配置
            pass

    async def put_object(self, key: str, data: bytes, content_type: str) -> str:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return self.get_url(key)

    async def get_object(self, key: str) -> bytes:
        response = await asyncio.to_thread(self._client.get_object, Bucket=self.bucket, Key=key)
        return await asyncio.to_thread(response["Body"].read)

    async def create_multipart(self, key: str, content_type: str) -> str:
        resp = await asyncio.to_thread(
            self._client.create_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            ContentType=content_type,
        )
        return str(resp["UploadId"])

    async def upload_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        resp = await asyncio.to_thread(
            self._client.upload_part,
            Bucket=self.bucket,
            Key=key,
            PartNumber=part_number,
            UploadId=upload_id,
            Body=data,
        )
        return str(resp["ETag"])

    async def complete_multipart(
        self, key: str, upload_id: str, parts: list[dict[str, Any]]
    ) -> str:
        # S3 要求 parts 按 PartNumber 递增
        sorted_parts = sorted(parts, key=lambda p: int(p["PartNumber"]))
        await asyncio.to_thread(
            self._client.complete_multipart_upload,
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": sorted_parts},
        )
        return self.get_url(key)

    async def abort_multipart(self, key: str, upload_id: str) -> None:
        try:
            await asyncio.to_thread(
                self._client.abort_multipart_upload,
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
            )
        except ClientError:
            # 已中止或不存在时静默忽略
            pass

    async def delete(self, key: str) -> None:
        try:
            await asyncio.to_thread(self._client.delete_object, Bucket=self.bucket, Key=key)
        except ClientError:
            pass

    def get_url(self, key: str) -> str:
        return f"{self.public_url.rstrip('/')}/{key}"


# ── 本地文件系统实现（测试与无 MinIO 开发环境） ───────────────────────────────


class LocalStorageService:
    """本地文件系统 fallback，接口与 S3StorageService 一致。

    分片存储在 ``local_uploads_dir/_sessions/{upload_id}/part_XXXX``，
    complete 时按序拼接并写入正式路径。
    """

    def __init__(self) -> None:
        self._base = Path(settings.local_uploads_dir).resolve()
        self._base.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, key: str) -> Path:
        target = (self._base / key).resolve()
        try:
            target.relative_to(self._base)
        except ValueError as e:
            raise ValueError(f"Invalid storage key: {key!r}") from e
        return target

    def _session_dir(self, upload_id: str) -> Path:
        # 校验 upload_id 是 UUID 字符串，防止路径注入
        try:
            uuid.UUID(upload_id)
        except ValueError as e:
            raise ValueError(f"Invalid upload_id: {upload_id!r}") from e
        return self._base / "_sessions" / upload_id

    async def ensure_bucket(self) -> None:
        # 本地实现无需 bucket 概念
        return

    async def put_object(self, key: str, data: bytes, content_type: str) -> str:
        target = self._resolve_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(target, "wb") as f:
            await f.write(data)
        return self.get_url(key)

    async def get_object(self, key: str) -> bytes:
        target = self._resolve_path(key)
        async with aiofiles.open(target, "rb") as f:
            content: bytes = await f.read()
            return content

    async def create_multipart(self, key: str, content_type: str) -> str:
        upload_id = str(uuid.uuid4())
        session_dir = self._session_dir(upload_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        # 记录目标 key，便于 complete 时校验
        async with aiofiles.open(session_dir / "_meta", "w") as f:
            await f.write(f"{key}\n{content_type}\n")
        return upload_id

    async def upload_part(self, key: str, upload_id: str, part_number: int, data: bytes) -> str:
        session_dir = self._session_dir(upload_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        part_path = session_dir / f"part_{part_number:04d}"
        async with aiofiles.open(part_path, "wb") as f:
            await f.write(data)
        # 用数据 MD5 作为 ETag，与 S3 语义一致
        return f'"{hashlib.md5(data).hexdigest()}"'

    async def complete_multipart(
        self, key: str, upload_id: str, parts: list[dict[str, Any]]
    ) -> str:
        session_dir = self._session_dir(upload_id)
        if not session_dir.exists():
            raise ValueError(f"Session {upload_id} does not exist")

        target = self._resolve_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        sorted_parts = sorted(parts, key=lambda p: int(p["PartNumber"]))

        async with aiofiles.open(target, "wb") as out:
            for part in sorted_parts:
                part_path = session_dir / f"part_{int(part['PartNumber']):04d}"
                if not part_path.exists():
                    raise ValueError(f"Missing part {part['PartNumber']}")
                async with aiofiles.open(part_path, "rb") as f:
                    while True:
                        chunk = await f.read(1024 * 1024)
                        if not chunk:
                            break
                        await out.write(chunk)

        shutil.rmtree(session_dir, ignore_errors=True)
        return self.get_url(key)

    async def abort_multipart(self, key: str, upload_id: str) -> None:
        try:
            session_dir = self._session_dir(upload_id)
        except ValueError:
            return
        shutil.rmtree(session_dir, ignore_errors=True)

    async def delete(self, key: str) -> None:
        try:
            target = self._resolve_path(key)
        except ValueError:
            return
        target.unlink(missing_ok=True)

    def get_url(self, key: str) -> str:
        return f"{settings.local_uploads_base_url.rstrip('/')}/{key}"


# ── 工厂 ──────────────────────────────────────────────────────────────────────


def _make_storage() -> StorageService:
    backend = (settings.storage_backend or "s3").lower()
    if backend == "local":
        return LocalStorageService()
    return S3StorageService()


storage: StorageService = _make_storage()
