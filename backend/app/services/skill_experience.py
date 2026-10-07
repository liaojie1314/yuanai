"""从成功 Run 的经验里按规则归纳可复用 Skill 候选。

本阶段**只生成候选**：聚类用确定性的归一化 + 关键词 Jaccard，不调模型 —— 候选最终要
进入评测门禁这条安全向链路，引入非确定性没有收益，也无法复现。候选必须由用户确认后
走正常的 `POST /skills` 草稿流程，这里不写库。
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.skill import Skill
from app.services.skill_validation import (
    SkillManifestError,
    parse_manifest,
    risk_rank,
    validate_manifest_tools,
)
from app.tools.builtin import build_phase6_registry
from app.tools.contracts import ToolRegistrationError, ToolRisk
from app.tools.registry import ToolRegistry

# phase-7 §7.3：相似任务成功完成至少 3 次才提出「保存为 Skill」。
MIN_OCCURRENCES = 3
# 目标文本关键词的 Jaccard 阈值；低于此值视为不同任务。
SIMILARITY_THRESHOLD = 0.6
# 只看最近这么多次成功 Run，避免历史越长扫描越慢。
RUN_SCAN_LIMIT = 200
# 单条候选最多列出的参数化位置，防止把一次性参数全抖出来。
MAX_PARAMETERS = 8

_WORD_RE = re.compile(r"[a-z0-9]+")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_SLUG_UNSAFE_RE = re.compile(r"[^a-z0-9_.-]+")


@dataclass(frozen=True, slots=True)
class SkillSuggestion:
    """一条可直接提交为草稿的 Skill 候选。"""

    slug: str
    name: str
    description: str
    occurrences: int
    run_ids: list[uuid.UUID]
    steps: list[str]
    parameters: list[str]
    required_tools: list[str]
    risk_ceiling: ToolRisk
    manifest: str
    skill_md: str


@dataclass(slots=True)
class _Cluster:
    """一组被判定为「同一类任务」的成功 Run。"""

    tokens: frozenset[str]
    runs: list[AgentRun] = field(default_factory=list)


async def suggest_skills_from_runs(
    *, user_id: uuid.UUID, db: AsyncSession, registry: ToolRegistry | None = None
) -> list[SkillSuggestion]:
    """归纳当前用户重复成功的任务，产出待确认的 Skill 候选。"""

    tool_registry = registry or build_phase6_registry()
    runs = list(
        (
            await db.scalars(
                select(AgentRun)
                .options(selectinload(AgentRun.steps))
                .where(AgentRun.user_id == user_id, AgentRun.status == AgentRunStatus.succeeded)
                .order_by(AgentRun.created_at.desc())
                .limit(RUN_SCAN_LIMIT)
            )
        )
        .unique()
        .all()
    )
    existing_slugs = set(
        (await db.scalars(select(Skill.slug).where(Skill.user_id == user_id))).all()
    )
    suggestions = []
    for cluster in _cluster_runs(runs):
        if len(cluster.runs) < MIN_OCCURRENCES:
            continue
        suggestion = _build_suggestion(cluster, tool_registry)
        if suggestion is not None and suggestion.slug not in existing_slugs:
            suggestions.append(suggestion)
    return sorted(suggestions, key=lambda item: (-item.occurrences, item.slug))


def _cluster_runs(runs: Sequence[AgentRun]) -> list[_Cluster]:
    """按目标关键词相似度贪心聚类；代表集合取首个成员，保证结果可复现。"""

    clusters: list[_Cluster] = []
    for run in runs:
        tokens = _goal_tokens(run.goal)
        if not tokens:
            continue
        match = next(
            (
                cluster
                for cluster in clusters
                if _jaccard(cluster.tokens, tokens) >= SIMILARITY_THRESHOLD
            ),
            None,
        )
        if match is None:
            clusters.append(_Cluster(tokens=tokens, runs=[run]))
        else:
            match.runs.append(run)
    return clusters


def _goal_tokens(goal: str) -> frozenset[str]:
    """把目标文本切成关键词集合。

    中文用二元组而不是单字：单字会让「写周报」和「写邮件」因为共享「写」而相似度虚高。
    """

    lowered = goal.lower()
    tokens = set(_WORD_RE.findall(lowered))
    for segment in _CJK_RE.findall(lowered):
        if len(segment) == 1:
            tokens.add(segment)
        tokens.update(segment[index : index + 2] for index in range(len(segment) - 1))
    return frozenset(tokens)


def _jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    """两个关键词集合的 Jaccard 相似度。"""

    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _build_suggestion(cluster: _Cluster, registry: ToolRegistry) -> SkillSuggestion | None:
    """把一个聚类组装成候选；无法通过自身校验的候选直接丢弃。

    候选必须自洽：生成后立刻按后端唯一接受的受限契约解析一遍，解析不过就不要递给
    客户端 —— 否则用户点「保存为草稿」会拿到 422。
    """

    steps = _tool_sequence(cluster.runs)
    resolved = _resolve_tools(steps, registry)
    if not resolved:
        return None
    required_tools = [f"{name}@^{version.split('.', 1)[0]}" for name, version, _ in resolved]
    risk_ceiling = max((risk for _, _, risk in resolved), key=risk_rank)
    parameters = _parameter_positions(cluster.runs)
    slug = _slug(cluster.tokens, steps[0])
    name = cluster.runs[0].goal.strip()[:120] or slug
    description = f"由 {len(cluster.runs)} 次成功任务归纳：{' → '.join(steps)}"[:500]
    skill_md = _skill_md(
        name=name,
        occurrences=len(cluster.runs),
        steps=steps,
        parameters=parameters,
        required_tools=required_tools,
    )
    manifest = _manifest(
        slug=slug,
        name=name,
        description=description,
        required_tools=required_tools,
        risk_ceiling=risk_ceiling,
    )
    try:
        validate_manifest_tools(parse_manifest(manifest, skill_md), registry)
    except SkillManifestError:
        return None
    return SkillSuggestion(
        slug=slug,
        name=name,
        description=description,
        occurrences=len(cluster.runs),
        run_ids=[run.id for run in cluster.runs],
        steps=steps,
        parameters=parameters,
        required_tools=required_tools,
        risk_ceiling=risk_ceiling,
        manifest=manifest,
        skill_md=skill_md,
    )


def _tool_sequence(runs: Iterable[AgentRun]) -> list[str]:
    """按首次出现顺序取聚类里成功工具步骤的工具名。"""

    ordered: list[str] = []
    for run in runs:
        for step in _successful_tool_steps(run):
            name = step.input_json.get("name") if step.input_json else None
            if isinstance(name, str) and name and name not in ordered:
                ordered.append(name)
    return ordered


def _successful_tool_steps(run: AgentRun) -> list[AgentStep]:
    """按 sequence 顺序返回一次 Run 中成功的工具步骤。"""

    return sorted(
        (
            step
            for step in run.steps
            if step.kind is AgentStepKind.tool and step.status is AgentStepStatus.succeeded
        ),
        key=lambda step: step.sequence,
    )


def _resolve_tools(steps: Sequence[str], registry: ToolRegistry) -> list[tuple[str, str, ToolRisk]]:
    """解析步骤里仍然注册的工具；已下线的工具不进 required_tools。

    步骤列表保留原始工具名（经验的如实记录），但声明只能写注册表里真实存在的工具，
    否则生成的候选自己就通不过验证。
    """

    resolved: list[tuple[str, str, ToolRisk]] = []
    for name in steps:
        try:
            spec = registry.get_spec(name)
        except ToolRegistrationError:
            continue
        resolved.append((spec.name, spec.version, spec.risk_level))
    return resolved


def _parameter_positions(runs: Sequence[AgentRun]) -> list[str]:
    """找出同一工具在多次执行间取值不同的参数，作为参数化位置。"""

    observed: dict[str, dict[str, set[str]]] = {}
    for run in runs:
        for step in _successful_tool_steps(run):
            payload = step.input_json or {}
            name = payload.get("name")
            arguments = payload.get("arguments")
            if not isinstance(name, str) or not isinstance(arguments, dict):
                continue
            per_tool = observed.setdefault(name, {})
            for key, value in arguments.items():
                per_tool.setdefault(key, set()).add(json.dumps(value, sort_keys=True, default=str))
    positions = [
        f"{tool}.{key}"
        for tool, arguments in sorted(observed.items())
        for key, values in sorted(arguments.items())
        if len(values) > 1
    ]
    return positions[:MAX_PARAMETERS]


def _slug(tokens: frozenset[str], first_tool: str) -> str:
    """生成稳定且合法的候选 slug。

    用关键词集合的摘要而不是目标原文：目标可能整段是中文，而 slug 只允许
    `[a-z0-9_.-]`，直接转写会得到空串。
    """

    digest = hashlib.sha256("\u0000".join(sorted(tokens)).encode()).hexdigest()[:8]
    tool_part = _SLUG_UNSAFE_RE.sub("-", first_tool.lower()).strip("-.") or "task"
    return f"experience.{tool_part[:60]}.{digest}"


def _skill_md(
    *,
    name: str,
    occurrences: int,
    steps: Sequence[str],
    parameters: Sequence[str],
    required_tools: Sequence[str],
) -> str:
    """生成候选指令正文；工具名用反引号写出，与评测的声明覆盖用例一致。"""

    lines = [
        f"# {name}",
        "",
        f"本说明由 {occurrences} 次成功任务自动归纳，请确认后再提交验证。",
        "",
        "## 步骤",
        "",
    ]
    lines += [f"{index}. 调用 `{step}`" for index, step in enumerate(steps, start=1) if step]
    lines += ["", "## 参数化位置", ""]
    lines += [f"- `{item}`" for item in parameters] if parameters else ["- 暂未发现跨次变化的参数"]
    lines += ["", "## 所需工具", ""]
    lines += [f"- {item}" for item in required_tools]
    return "\n".join(lines)


def _manifest(
    *,
    slug: str,
    name: str,
    description: str,
    required_tools: Sequence[str],
    risk_ceiling: ToolRisk,
) -> str:
    """生成后端唯一接受的受限 YAML manifest。

    字符串标量统一用 JSON 转义写出：归纳出的名称来自用户目标，可能含冒号或引号，
    直接拼进 YAML 会破坏结构。
    """

    lines = [
        f"id: {json.dumps(slug)}",
        "version: 1.0.0",
        f"name: {json.dumps(name)}",
        f"description: {json.dumps(description)}",
        "entrypoint: SKILL.md",
        "required_tools:",
        *[f"  - {json.dumps(item)}" for item in required_tools],
        f"risk_ceiling: {risk_ceiling.value}",
    ]
    return "\n".join(lines)
