"""外部凭证存储的最小隔离接口。"""

from __future__ import annotations

import os
import re
import uuid
from typing import Protocol


class SecretStoreUnavailableError(RuntimeError):
    """当前部署没有可用的 SecretStore。"""


class SecretStore(Protocol):
    """按租户解析不进入普通数据库和日志的凭证引用。"""

    async def get(self, owner_id: uuid.UUID, secret_ref: str) -> str | None:
        """读取指定租户的 SecretRef 对应值。"""


class EnvironmentSecretStore:
    """读取运维显式注入的 MCP Secret，不把值持久化到应用数据库。"""

    _REF_RE = re.compile(r"^env://(YUANAI_MCP_SECRET_[A-Z0-9_]+)$")

    async def get(self, owner_id: uuid.UUID, secret_ref: str) -> str | None:
        """只允许读取命名空间内的环境 Secret，并忽略租户可控的任意变量名。"""

        del owner_id
        match = self._REF_RE.fullmatch(secret_ref)
        if match is None:
            raise SecretStoreUnavailableError("unsupported secret reference")
        value = os.environ.get(match.group(1), "")
        return value or None
