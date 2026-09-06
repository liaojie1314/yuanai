"""外部凭证存储的租户隔离接口与实现。"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
import uuid
from typing import Protocol

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tool_runtime import SecretRecord

SecretValue = str
SecretRef = str


class SecretStoreUnavailableError(RuntimeError):
    """当前部署没有可用的 SecretStore，或引用不属于该租户。"""


class SecretStore(Protocol):
    """按租户解析不进入普通数据库和日志的凭证引用。"""

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """校验引用格式属于该租户；跨租户或非法引用必须拒绝。"""

    async def put(self, owner_id: uuid.UUID, value: SecretValue) -> SecretRef:
        """以加密形式保存凭证并返回不含明文的引用。"""

    async def get(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> SecretValue | None:
        """读取指定租户的 SecretRef 对应值。"""

    async def delete(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """删除指定租户的凭证。"""


class EnvironmentSecretStore:
    """读取运维显式注入的 MCP Secret，不把值持久化到应用数据库。

    引用格式为 env://YUANAI_MCP_SECRET_<USER_ID>_<NAME>：<USER_ID> 是
    去掉连字符的大写租户 UUID，<NAME> 为大写字母数字下划线。引用必须内嵌
    租户身份，防止一个租户通过自建连接读取另一个租户或部署级的其他密钥。
    """

    _REF_RE = re.compile(r"^env://YUANAI_MCP_SECRET_(?P<owner>[0-9A-F]{32})_(?P<name>[A-Z0-9_]+)$")

    @staticmethod
    def _tenant_key(owner_id: uuid.UUID) -> str:
        """把租户 UUID 规范成环境变量名中的大写无连字符形式。"""

        return owner_id.hex.upper()

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """校验引用属于该租户；不属于时拒绝，避免跨租户取用部署密钥。"""

        match = self._REF_RE.fullmatch(secret_ref)
        if match is None or match.group("owner") != self._tenant_key(owner_id):
            raise SecretStoreUnavailableError("secret reference is not owned by this tenant")

    async def put(self, _owner_id: uuid.UUID, _value: SecretValue) -> SecretRef:
        """环境变量适配器只读，凭证写入必须使用可持久化 SecretStore。"""

        raise SecretStoreUnavailableError("environment secret store is read-only")

    async def get(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> SecretValue | None:
        """只允许读取命名空间内、且属于该租户的环境 Secret。"""

        self.assert_ref_allowed(owner_id, secret_ref)
        match = self._REF_RE.fullmatch(secret_ref)
        if match is None:
            raise SecretStoreUnavailableError("unsupported secret reference")
        value = os.environ.get(f"YUANAI_MCP_SECRET_{match.group('owner')}_{match.group('name')}")
        return value or None

    async def delete(self, _owner_id: uuid.UUID, _secret_ref: SecretRef) -> None:
        """环境变量由部署管理，应用不能删除。"""

        raise SecretStoreUnavailableError("environment secret store is read-only")


class DatabaseSecretStore:
    """使用独立部署密钥和 AES-GCM 保存租户 Secret。"""

    _REF_RE = re.compile(r"^db://(?P<owner>[0-9A-F]{32})/(?P<secret>[0-9a-f-]{36})$")
    _MAX_VALUE_LENGTH = 16_384

    def __init__(self, session_factory: async_sessionmaker[AsyncSession] | None = None) -> None:
        self._session_factory = session_factory or AsyncSessionLocal

    @staticmethod
    def _key() -> bytes:
        """从独立部署密钥派生 AES-256 密钥；缺失时拒绝降级。"""

        source = settings.secret_store_encryption_key
        if not source:
            raise SecretStoreUnavailableError("secret store encryption key is not configured")
        return hashlib.sha256(source.encode("utf-8")).digest()

    @staticmethod
    def _aad(owner_id: uuid.UUID, secret_id: uuid.UUID) -> bytes:
        """将密文绑定到租户和记录 ID，阻止跨记录替换。"""

        return f"{owner_id}:{secret_id}".encode("ascii")

    @classmethod
    def _reference(cls, owner_id: uuid.UUID, secret_id: uuid.UUID) -> SecretRef:
        """生成携带租户边界的数据库引用。"""

        return f"db://{owner_id.hex.upper()}/{secret_id}"

    @classmethod
    def _parse_reference(cls, owner_id: uuid.UUID, secret_ref: SecretRef) -> uuid.UUID:
        """解析并校验数据库引用中的租户身份。"""

        match = cls._REF_RE.fullmatch(secret_ref)
        if match is None or match.group("owner") != owner_id.hex.upper():
            raise SecretStoreUnavailableError("secret reference is not owned by this tenant")
        try:
            return uuid.UUID(match.group("secret"))
        except ValueError as error:
            raise SecretStoreUnavailableError("invalid secret reference") from error

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """拒绝非法或跨租户数据库引用。"""

        self._parse_reference(owner_id, secret_ref)

    async def put(self, owner_id: uuid.UUID, value: SecretValue) -> SecretRef:
        """加密保存凭证；数据库记录和引用都不包含明文。"""

        if not value or len(value) > self._MAX_VALUE_LENGTH:
            raise SecretStoreUnavailableError("secret value is empty or too large")
        secret_id = uuid.uuid4()
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(self._key()).encrypt(
            nonce, value.encode("utf-8"), self._aad(owner_id, secret_id)
        )
        encoded = ".".join(
            base64.urlsafe_b64encode(part).decode("ascii").rstrip("=")
            for part in (nonce, ciphertext)
        )
        async with self._session_factory() as session:
            session.add(SecretRecord(id=secret_id, owner_id=owner_id, ciphertext=encoded))
            await session.commit()
        return self._reference(owner_id, secret_id)

    async def get(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> SecretValue | None:
        """读取并解密本租户的凭证；密文损坏时 fail closed。"""

        secret_id = self._parse_reference(owner_id, secret_ref)
        async with self._session_factory() as session:
            record = await session.scalar(
                select(SecretRecord).where(
                    SecretRecord.id == secret_id, SecretRecord.owner_id == owner_id
                )
            )
        if record is None:
            return None
        try:
            nonce_value, ciphertext_value = record.ciphertext.split(".", 1)
            nonce = base64.urlsafe_b64decode(nonce_value + "=" * (-len(nonce_value) % 4))
            ciphertext = base64.urlsafe_b64decode(
                ciphertext_value + "=" * (-len(ciphertext_value) % 4)
            )
            plaintext = AESGCM(self._key()).decrypt(
                nonce, ciphertext, self._aad(owner_id, secret_id)
            )
            return plaintext.decode("utf-8")
        except (InvalidTag, UnicodeDecodeError, ValueError, TypeError) as error:
            raise SecretStoreUnavailableError("secret ciphertext is invalid") from error

    async def delete(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """删除本租户的凭证记录；重复删除保持幂等。"""

        secret_id = self._parse_reference(owner_id, secret_ref)
        async with self._session_factory() as session:
            record = await session.scalar(
                select(SecretRecord).where(
                    SecretRecord.id == secret_id, SecretRecord.owner_id == owner_id
                )
            )
            if record is not None:
                await session.delete(record)
                await session.commit()


class TenantSecretStore:
    """按引用类型路由数据库 Secret 和兼容的环境 Secret。"""

    def __init__(
        self,
        database_store: DatabaseSecretStore | None = None,
        environment_store: EnvironmentSecretStore | None = None,
    ) -> None:
        self._database_store = database_store or DatabaseSecretStore()
        self._environment_store = environment_store or EnvironmentSecretStore()

    def _store_for(self, secret_ref: SecretRef) -> SecretStore:
        if secret_ref.startswith("db://"):
            return self._database_store
        if secret_ref.startswith("env://"):
            return self._environment_store
        raise SecretStoreUnavailableError("unsupported secret reference")

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """按引用协议执行租户边界校验。"""

        self._store_for(secret_ref).assert_ref_allowed(owner_id, secret_ref)

    async def put(self, owner_id: uuid.UUID, value: SecretValue) -> SecretRef:
        """把新凭证保存到数据库 SecretStore。"""

        return await self._database_store.put(owner_id, value)

    async def get(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> SecretValue | None:
        """按引用类型读取凭证。"""

        return await self._store_for(secret_ref).get(owner_id, secret_ref)

    async def delete(self, owner_id: uuid.UUID, secret_ref: SecretRef) -> None:
        """按引用类型删除凭证，环境变量删除会 fail closed。"""

        await self._store_for(secret_ref).delete(owner_id, secret_ref)
