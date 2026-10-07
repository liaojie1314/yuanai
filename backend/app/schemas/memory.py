"""Memory and Context API 的输入输出契约。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.memory import (
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
    MemoryType,
)


class MemorySchema(BaseModel):
    """记忆 Schema 的公共序列化配置。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


# 记忆检索查询的字符上限，云端与桌面节点共用这一个数字。
# 500 取自节点 jobs.ts 的 runMemorySearch —— 它是全链路唯一真正拦住过长查询的地方，
# 而云端此前声明的 10000 只是摆设：simple 配置下整句中文只得到一个词元，
# 超过 2046 字节（约 682 个汉字）时 plainto_tsquery 会静默退化成空查询，
# 向量臂也会在 embedding 模型的 token 上限处静默关闭，子串匹配更不可能命中比正文还长的查询。
# 记忆检索是搜索框而不是文档入口，500 字对一次查询足够宽裕。
MEMORY_SEARCH_MAX_QUERY_CHARS = 500


class MemoryCreateCandidate(MemorySchema):
    """创建待确认记忆的可信边界输入。"""

    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    memory_type: MemoryType
    content: str = Field(min_length=1, max_length=10_000)
    structured_data: dict[str, object] | None = None
    source_type: str = Field(min_length=1, max_length=40)
    source_id: str | None = Field(default=None, max_length=100)
    source_excerpt: str | None = Field(default=None, max_length=2_000)
    confidence: float = Field(default=0.0, ge=0, le=1)
    sensitivity: MemorySensitivity = MemorySensitivity.personal
    storage_location: MemoryStorageLocation = MemoryStorageLocation.cloud
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryUpdate(MemorySchema):
    """修改记忆内容或经政策允许的生命周期字段。"""

    content: str | None = Field(default=None, min_length=1, max_length=10_000)
    structured_data: dict[str, object] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    sensitivity: MemorySensitivity | None = None
    status: MemoryStatus | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryResponse(MemorySchema):
    """记忆管理接口返回的完整资源表示。"""

    id: uuid.UUID
    user_id: uuid.UUID
    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None
    memory_type: MemoryType
    content: str | None
    structured_data: dict[str, object] | None
    source_type: str
    source_id: str | None
    source_excerpt: str | None
    confidence: float
    sensitivity: MemorySensitivity
    storage_location: MemoryStorageLocation
    node_id: uuid.UUID | None
    status: MemoryStatus
    valid_from: datetime | None
    valid_until: datetime | None
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MemoryPage(MemorySchema):
    """记忆列表的一页，附带本地正文此刻是否可读。"""

    items: list[MemoryResponse]
    next_cursor: str | None = None
    local_unavailable: bool = False


class MemoryExport(MemorySchema):
    """一次性导出的记忆快照。

    导出文件里 local_node 记忆的正文恒为 ``None`` —— 正文只在用户自己的机器上，
    导出不会去节点取。``local_unavailable`` 补上文件本身看不出来的那一半：
    导出这一刻节点是否可达。哪几条受影响不另列名单，
    每条记录自带 ``storage_location`` 与 ``content``，再存一份 id 只会和它们走散。
    """

    exported_at: datetime
    items: list[MemoryResponse]
    local_unavailable: bool = False


class MemorySearchResult(MemorySchema):
    """用于管理界面或上下文组装的检索结果。"""

    id: uuid.UUID
    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None
    memory_type: MemoryType
    content: str
    source_type: str
    source_id: str | None
    source_excerpt: str | None
    confidence: float
    sensitivity: MemorySensitivity
    status: MemoryStatus
    score: float


class MemorySearchOutcome(MemorySchema):
    """检索结果及本地节点可用性，供上下文组装区分空结果与不可用。"""

    results: list[MemorySearchResult]
    local_unavailable: bool = False


class MemoryContextItem(MemorySchema):
    """可注入 Agent 上下文的、不可信记忆表示。"""

    id: uuid.UUID
    content: str
    source_type: str
    source_id: str | None
    confidence: float
    untrusted: bool = True
