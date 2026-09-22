"""检索评测用的固定语料、标注查询与三项指标。

语料全部为合成内容，不含任何真实或拟真的个人信息。
高置信度条目是各查询的标准答案，低置信度条目是同话题干扰项或近义重复，
用于验证「先过滤、再融合、最后规则重排」的顺序没有被回退成单路排序。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from app.models.memory import MemoryType
from app.schemas.memory import MemorySearchResult

# 语料 id 由 key 派生，保证跨进程稳定，便于失败时定位具体条目
EVAL_NAMESPACE = uuid.UUID("6f1d4c2e-9a3b-4f58-8c17-2d5e7b90a4c3")

# 标准答案的置信度；与干扰项拉开足够间距，使规则重排的排序不依赖关键词臂的并列顺序
RELEVANT_CONFIDENCE = 0.98
# 干扰项的置信度
DISTRACTOR_CONFIDENCE = 0.10


@dataclass(frozen=True)
class EvalMemory:
    """评测语料中的一条记忆。"""

    key: str
    memory_type: MemoryType
    content: str
    confidence: float
    subject: str | None = None

    @property
    def memory_id(self) -> uuid.UUID:
        """由 key 派生的稳定 id。"""

        return uuid.uuid5(EVAL_NAMESPACE, self.key)


@dataclass(frozen=True)
class EvalQuery:
    """一条标注查询及其标准答案集合。"""

    text: str
    relevant_ids: frozenset[str]


EVAL_MEMORIES: tuple[EvalMemory, ...] = (
    # preference
    EvalMemory("p1", MemoryType.preference, "用户偏好深色主题界面", RELEVANT_CONFIDENCE, "界面"),
    EvalMemory(
        "p2", MemoryType.preference, "用户偏好中文回复，不要混用英文", RELEVANT_CONFIDENCE, "语言"
    ),
    EvalMemory(
        "p3", MemoryType.preference, "用户偏好简洁的回答，不需要冗长铺垫", RELEVANT_CONFIDENCE
    ),
    EvalMemory(
        "p4",
        MemoryType.preference,
        "用户偏好代码示例使用 Python 而不是伪代码",
        RELEVANT_CONFIDENCE,
    ),
    EvalMemory(
        "p5", MemoryType.preference, "用户偏好周一上午安排评审会议", RELEVANT_CONFIDENCE, "日程"
    ),
    EvalMemory("p6", MemoryType.preference, "用户偏好用表格对比多个方案", RELEVANT_CONFIDENCE),
    EvalMemory(
        "p7", MemoryType.preference, "测试助理默认使用深色主题模板", DISTRACTOR_CONFIDENCE, "界面"
    ),
    EvalMemory("p8", MemoryType.preference, "用户偏好中文文件名", DISTRACTOR_CONFIDENCE, "语言"),
    EvalMemory("p9", MemoryType.preference, "用户不喜欢自动播放的语音回复", DISTRACTOR_CONFIDENCE),
    # profile
    EvalMemory("f1", MemoryType.profile, "用户在测试团队负责后端方向", RELEVANT_CONFIDENCE, "角色"),
    EvalMemory("f2", MemoryType.profile, "用户使用的开发环境是 Linux 桌面", RELEVANT_CONFIDENCE),
    EvalMemory("f3", MemoryType.profile, "用户的常用时区是 UTC+8", RELEVANT_CONFIDENCE),
    EvalMemory("f4", MemoryType.profile, "用户负责测试项目A 的数据层", RELEVANT_CONFIDENCE, "角色"),
    EvalMemory("f5", MemoryType.profile, "用户是测试项目B 的评审人", DISTRACTOR_CONFIDENCE, "角色"),
    EvalMemory("f6", MemoryType.profile, "测试团队共有四个方向", DISTRACTOR_CONFIDENCE),
    EvalMemory("f7", MemoryType.profile, "用户的账号语言设置为中文", DISTRACTOR_CONFIDENCE, "语言"),
    EvalMemory("f8", MemoryType.profile, "用户在测试团队担任过轮值值班", DISTRACTOR_CONFIDENCE),
    # semantic
    EvalMemory(
        "s1", MemoryType.semantic, "测试项目A 使用 Python 3.12 与 FastAPI", RELEVANT_CONFIDENCE
    ),
    EvalMemory(
        "s2", MemoryType.semantic, "测试项目A 的数据库是 PostgreSQL 16", RELEVANT_CONFIDENCE
    ),
    EvalMemory(
        "s3", MemoryType.semantic, "测试项目B 使用 TypeScript 与 Next.js", RELEVANT_CONFIDENCE
    ),
    EvalMemory("s4", MemoryType.semantic, "向量检索由 pgvector 扩展提供", RELEVANT_CONFIDENCE),
    EvalMemory(
        "s5", MemoryType.semantic, "关键词检索使用 PostgreSQL 全文索引", RELEVANT_CONFIDENCE
    ),
    EvalMemory("s6", MemoryType.semantic, "测试项目A 的缓存层使用 Redis", RELEVANT_CONFIDENCE),
    EvalMemory(
        "s7",
        MemoryType.semantic,
        "测试项目C 也使用 PostgreSQL，但版本是 14",
        DISTRACTOR_CONFIDENCE,
    ),
    EvalMemory("s8", MemoryType.semantic, "旧版测试项目A 曾使用 Python 3.9", DISTRACTOR_CONFIDENCE),
    EvalMemory("s9", MemoryType.semantic, "文档站点使用 Next.js 静态导出", DISTRACTOR_CONFIDENCE),
    # episodic
    EvalMemory(
        "e1", MemoryType.episodic, "上次评审会议决定推迟测试项目B 的发布", RELEVANT_CONFIDENCE
    ),
    EvalMemory(
        "e2",
        MemoryType.episodic,
        "上周把测试项目A 的数据库迁移到 PostgreSQL 16",
        RELEVANT_CONFIDENCE,
    ),
    EvalMemory(
        "e3", MemoryType.episodic, "用户在评审会议上提出要补充检索评测集", RELEVANT_CONFIDENCE
    ),
    EvalMemory(
        "e4", MemoryType.episodic, "昨天修复了向量检索的维度不匹配问题", RELEVANT_CONFIDENCE
    ),
    EvalMemory("e5", MemoryType.episodic, "上个月的评审会议没有形成结论", DISTRACTOR_CONFIDENCE),
    EvalMemory(
        "e6",
        MemoryType.episodic,
        "曾经讨论过把缓存换成 Memcached，最后没有采纳",
        DISTRACTOR_CONFIDENCE,
    ),
    EvalMemory("e7", MemoryType.episodic, "测试项目C 的迁移在上季度取消", DISTRACTOR_CONFIDENCE),
    EvalMemory(
        "e8", MemoryType.episodic, "用户请求过导出全部记忆，当时功能未上线", DISTRACTOR_CONFIDENCE
    ),
)

# 前 16 条查询的关键词可直接在标准答案中找到；后 4 条只有语义关联、没有字面重合，
# 关键词单路必然召回为空，正是向量臂接入后应当被抬高的部分。
EVAL_QUERIES: tuple[EvalQuery, ...] = (
    EvalQuery("深色主题", frozenset({"p1"})),
    EvalQuery("中文", frozenset({"p2"})),
    EvalQuery("简洁", frozenset({"p3"})),
    EvalQuery("Python", frozenset({"s1", "p4"})),
    EvalQuery("PostgreSQL", frozenset({"s2", "s5", "e2"})),
    EvalQuery("评审会议", frozenset({"p5", "e1", "e3"})),
    EvalQuery("测试项目A", frozenset({"f4", "s1", "s2", "s6", "e2"})),
    EvalQuery("测试项目B", frozenset({"s3", "e1"})),
    EvalQuery("向量检索", frozenset({"s4", "e4"})),
    EvalQuery("pgvector", frozenset({"s4"})),
    EvalQuery("Redis", frozenset({"s6"})),
    EvalQuery("时区", frozenset({"f3"})),
    EvalQuery("Linux", frozenset({"f2"})),
    EvalQuery("TypeScript", frozenset({"s3"})),
    EvalQuery("后端", frozenset({"f1"})),
    EvalQuery("缓存", frozenset({"s6"})),
    EvalQuery("数据库版本", frozenset({"s2"})),
    EvalQuery("会议纪要", frozenset({"e1", "e3"})),
    EvalQuery("界面配色", frozenset({"p1"})),
    EvalQuery("编程语言", frozenset({"s1", "s3"})),
)


def recall_at_k(ranked_ids: Sequence[str], relevant_ids: frozenset[str], k: int) -> float:
    """前 k 条结果覆盖了多少比例的标准答案。"""

    if not relevant_ids:
        return 0.0
    return len(set(ranked_ids[:k]) & relevant_ids) / len(relevant_ids)


def mean_reciprocal_rank(rankings: Sequence[Sequence[bool]]) -> float:
    """按首个命中位置的倒数求平均；每条查询传入逐位的命中标记。"""

    if not rankings:
        return 0.0
    total = 0.0
    for flags in rankings:
        for position, hit in enumerate(flags, start=1):
            if hit:
                total += 1.0 / position
                break
    return total / len(rankings)


def citation_accuracy(results: Sequence[MemorySearchResult]) -> float:
    """结果中能回到原文位置（来源类型与来源 id 齐备）的比例。"""

    if not results:
        return 0.0
    resolvable = sum(
        1 for result in results if result.source_type.strip() and (result.source_id or "").strip()
    )
    return resolvable / len(results)
