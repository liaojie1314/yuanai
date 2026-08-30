"""外部凭证存储的最小隔离接口。"""

from __future__ import annotations

import os
import re
import uuid
from typing import Protocol


class SecretStoreUnavailableError(RuntimeError):
    """当前部署没有可用的 SecretStore，或引用不属于该租户。"""


class SecretStore(Protocol):
    """按租户解析不进入普通数据库和日志的凭证引用。"""

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: str) -> None:
        """校验引用格式属于该租户；跨租户或非法引用必须拒绝。"""

    async def get(self, owner_id: uuid.UUID, secret_ref: str) -> str | None:
        """读取指定租户的 SecretRef 对应值。"""


class EnvironmentSecretStore:
    """读取运维显式注入的 MCP Secret，不把值持久化到应用数据库。

    引用格式为 ``env://YUANAI_MCP_SECRET_<USER_ID>_<NAME>``：``<USER_ID>`` 是
    去掉连字符的大写租户 UUID，``<NAME>`` 为大写字母数字下划线。引用必须内嵌
    租户身份，防止一个租户通过自建连接读取另一个租户或部署级的其他密钥。
    """

    _REF_RE = re.compile(r"^env://YUANAI_MCP_SECRET_(?P<owner>[0-9A-F]{32})_(?P<name>[A-Z0-9_]+)$")

    @staticmethod
    def _tenant_key(owner_id: uuid.UUID) -> str:
        """把租户 UUID 规范成环境变量名中的大写无连字符形式。"""

        return owner_id.hex.upper()

    def assert_ref_allowed(self, owner_id: uuid.UUID, secret_ref: str) -> None:
        """校验引用属于该租户；不属于时拒绝，避免跨租户取用部署密钥。"""

        match = self._REF_RE.fullmatch(secret_ref)
        if match is None or match.group("owner") != self._tenant_key(owner_id):
            raise SecretStoreUnavailableError("secret reference is not owned by this tenant")

    async def get(self, owner_id: uuid.UUID, secret_ref: str) -> str | None:
        """只允许读取命名空间内、且属于该租户的环境 Secret。"""

        self.assert_ref_allowed(owner_id, secret_ref)
        match = self._REF_RE.fullmatch(secret_ref)
        if match is None:
            raise SecretStoreUnavailableError("unsupported secret reference")
        value = os.environ.get(f"YUANAI_MCP_SECRET_{match.group('owner')}_{match.group('name')}")
        return value or None
