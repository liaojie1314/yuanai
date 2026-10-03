"""Skill 版本的静态契约评测用例，是替换 active 版本的门禁依据。

这里只做可重放的静态检查，**不执行 Skill**：Skill 目前没有运行时消费者，没有执行面
就没有真实成功率、成本和平均 Step 可测。一个恒为 0 的指标比留空更有害，因为它看起来
像真实数据，所以成本与步数由调用方一律留 `NULL`，并用 `SkillEvaluationMode` 如实
标出取样方式。

用例都是纯函数，不碰数据库，便于单测直接构造输入。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.skill import SkillVersion
from app.services.skill_validation import (
    SkillManifest,
    SkillManifestError,
    content_digest,
    parse_manifest,
    risk_rank,
    validate_manifest_tools,
)
from app.tools.registry import ToolRegistry

# 指令里引用工具的约定写法是反引号包裹的工具名；只认这种写法可以避免把散文里的
# "calculate the total" 误判成调用 calculate 工具。
_CODE_SPAN_RE = re.compile(r"`([^`\n]{1,120})`")

# 静态扫描只认高置信度的凭据字面量，detail 里只回报模式名，绝不回显命中的内容。
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("api_key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
)

_MANIFEST_DEPENDENT = "manifest 未通过解析，本用例无法判定"


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    """一条静态用例的判定结果。"""

    name: str
    passed: bool
    detail: str

    def as_record(self) -> dict[str, str]:
        """转为可入库的扁平记录，字段全是字符串便于审计展示。"""

        return {
            "name": self.name,
            "status": "passed" if self.passed else "failed",
            "detail": self.detail,
        }


def run_static_contract_cases(
    *, version: SkillVersion, active_version: SkillVersion | None, registry: ToolRegistry
) -> list[EvaluationCase]:
    """针对当前工具注册表重放一个版本的全部静态契约用例。

    用例集长度固定：依赖 manifest 的用例在解析失败时判失败而不是跳过，确保门禁
    fail closed —— 少一条用例会让通过率虚高。
    """

    manifest = _parse(version)
    return [
        _manifest_case(version, manifest),
        _content_integrity_case(version),
        _tool_contract_case(manifest, registry),
        _declared_tool_coverage_case(version, manifest, registry),
        _risk_ceiling_case(version, active_version),
        _secret_scan_case(version),
    ]


def _parse(version: SkillVersion) -> SkillManifest | None:
    """解析版本 manifest，失败时返回 None 让各用例统一判失败。"""

    try:
        return parse_manifest(version.manifest_text, version.skill_md)
    except SkillManifestError:
        return None


def _manifest_case(version: SkillVersion, manifest: SkillManifest | None) -> EvaluationCase:
    """manifest 必须仍能解析，且声明版本与版本行一致。"""

    if manifest is None:
        return EvaluationCase("manifest_contract", False, "manifest 不符合受限声明契约")
    if manifest.version != version.version:
        return EvaluationCase(
            "manifest_contract",
            False,
            f"manifest 声明 {manifest.version}，版本行是 {version.version}",
        )
    return EvaluationCase("manifest_contract", True, "manifest 字段与版本号一致")


def _content_integrity_case(version: SkillVersion) -> EvaluationCase:
    """内容指纹必须与入库时一致，否则版本在落库后被改写过。"""

    expected = content_digest(version.manifest_text, version.skill_md)
    if expected != version.content_hash:
        return EvaluationCase("content_integrity", False, "内容指纹与入库时不一致")
    return EvaluationCase("content_integrity", True, "内容指纹与入库时一致")


def _tool_contract_case(manifest: SkillManifest | None, registry: ToolRegistry) -> EvaluationCase:
    """所声明工具必须仍然注册、版本可满足且不超过风险上限。

    与创建时的验证同一套规则，但在**评测时点**重放：工具可能已下线或升主版本，
    这正是替换 active 版本前必须重测的原因。
    """

    if manifest is None:
        return EvaluationCase("tool_contract", False, _MANIFEST_DEPENDENT)
    try:
        validate_manifest_tools(manifest, registry)
    except SkillManifestError as error:
        return EvaluationCase("tool_contract", False, "、".join(error.errors))
    return EvaluationCase(
        "tool_contract", True, f"{len(manifest.required_tools)} 个声明工具全部可用"
    )


def _declared_tool_coverage_case(
    version: SkillVersion, manifest: SkillManifest | None, registry: ToolRegistry
) -> EvaluationCase:
    """指令中以反引号引用的工具必须出现在 required_tools 里。

    未声明的工具调用会绕过 manifest 的风险上限 —— 指令让 Agent 用一个没进声明的
    高风险工具，审批和预算就都按错误的上限计算。
    """

    if manifest is None:
        return EvaluationCase("declared_tool_coverage", False, _MANIFEST_DEPENDENT)
    declared = {requirement.split("@", 1)[0] for requirement in manifest.required_tools}
    registered = {spec.name for spec in registry.list_specs()}
    referenced = {span for span in _CODE_SPAN_RE.findall(version.skill_md) if span in registered}
    undeclared = sorted(referenced - declared)
    if undeclared:
        return EvaluationCase(
            "declared_tool_coverage", False, f"指令引用但未声明：{'、'.join(undeclared)}"
        )
    return EvaluationCase("declared_tool_coverage", True, "指令未引用任何未声明工具")


def _risk_ceiling_case(
    version: SkillVersion, active_version: SkillVersion | None
) -> EvaluationCase:
    """新版本不得抬高风险上限，否则替换 active 等于静默扩权。"""

    if active_version is None or active_version.id == version.id:
        return EvaluationCase("risk_ceiling_not_escalated", True, "没有待替换的 active 版本")
    if risk_rank(version.risk_ceiling) > risk_rank(active_version.risk_ceiling):
        return EvaluationCase(
            "risk_ceiling_not_escalated",
            False,
            f"风险上限由 {active_version.risk_ceiling.value} 抬高到 {version.risk_ceiling.value}",
        )
    return EvaluationCase(
        "risk_ceiling_not_escalated", True, f"风险上限不高于 {active_version.risk_ceiling.value}"
    )


def _secret_scan_case(version: SkillVersion) -> EvaluationCase:
    """manifest 与指令里不得内联凭据字面量。"""

    content = f"{version.manifest_text}\n{version.skill_md}"
    hits = sorted(name for name, pattern in _SECRET_PATTERNS if pattern.search(content))
    if hits:
        return EvaluationCase("secret_scan", False, f"命中凭据模式：{'、'.join(hits)}")
    return EvaluationCase("secret_scan", True, "未发现内联凭据字面量")
