"""Skill manifest 的受限解析与 Tool Registry 校验。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.tools.contracts import ToolRegistrationError, ToolRisk
from app.tools.registry import ToolRegistry

_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_CARET_RE = re.compile(r"^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$")
_REQUIREMENT_RE = re.compile(
    r"^(?P<name>[a-z][a-z0-9_.-]{0,99})@(?P<version>\d+\.\d+\.\d+|\^\d+(?:\.\d+){0,2})$"
)
_RISK_ORDER = {
    ToolRisk.read: 0,
    ToolRisk.local_write: 1,
    ToolRisk.reversible_write: 2,
    ToolRisk.external_side_effect: 3,
    ToolRisk.destructive: 4,
    ToolRisk.financial: 5,
    ToolRisk.privileged: 6,
}


class SkillManifestError(ValueError):
    """Skill 内容不符合受限声明契约时使用的稳定错误。"""

    def __init__(self, *errors: str) -> None:
        self.errors = list(errors) or ["SKILL_MANIFEST_INVALID"]
        super().__init__(self.errors[0])


class SkillManifest(BaseModel):
    """允许进入版本库的最小 manifest 字段集。"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_.-]{0,119}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    entrypoint: str = Field(pattern=r"^SKILL\.md$")
    required_tools: list[str] = Field(default_factory=list, max_length=30)
    risk_ceiling: ToolRisk
    inputs_schema: str | None = None
    outputs_schema: str | None = None
    tests: str | None = None


@dataclass(frozen=True, slots=True)
class ParsedToolRequirement:
    """一个已拆分的工具及其受限版本条件。"""

    name: str
    version_requirement: str


def parse_manifest(manifest_text: str, skill_md: str) -> SkillManifest:
    """安全解析 YAML，并拒绝动态字段或不安全的引用路径。"""

    if not skill_md.strip():
        raise SkillManifestError("SKILL_MD_REQUIRED")
    try:
        document = yaml.safe_load(manifest_text)
    except yaml.YAMLError as error:
        raise SkillManifestError("SKILL_MANIFEST_INVALID") from error
    if not isinstance(document, dict):
        raise SkillManifestError("SKILL_MANIFEST_INVALID")
    try:
        manifest = SkillManifest.model_validate(document)
    except ValidationError as error:
        raise SkillManifestError("SKILL_MANIFEST_INVALID") from error
    for path in (manifest.inputs_schema, manifest.outputs_schema, manifest.tests):
        if path is not None:
            _validate_reference_path(path)
    for requirement in manifest.required_tools:
        parse_tool_requirement(requirement)
    return manifest


def parse_tool_requirement(value: str) -> ParsedToolRequirement:
    """解析 name@exact 或 name@caret 工具版本条件。"""

    match = _REQUIREMENT_RE.fullmatch(value)
    if match is None:
        raise SkillManifestError("SKILL_TOOL_REQUIREMENT_INVALID")
    return ParsedToolRequirement(name=match["name"], version_requirement=match["version"])


def validate_manifest_tools(manifest: SkillManifest, registry: ToolRegistry) -> dict[str, object]:
    """验证声明工具已注册、版本匹配且不超过 Skill 风险上限。"""

    validated: list[dict[str, str]] = []
    errors: list[str] = []
    for value in manifest.required_tools:
        requirement = parse_tool_requirement(value)
        try:
            spec = registry.get_spec(requirement.name)
        except ToolRegistrationError:
            errors.append("SKILL_TOOL_NOT_FOUND")
            continue
        if not version_satisfies(spec.version, requirement.version_requirement):
            errors.append("SKILL_TOOL_VERSION_UNSUPPORTED")
            continue
        if _RISK_ORDER[spec.risk_level] > _RISK_ORDER[manifest.risk_ceiling]:
            errors.append("SKILL_RISK_CEILING_TOO_LOW")
            continue
        validated.append(
            {
                "name": spec.name,
                "version": spec.version,
                "riskLevel": spec.risk_level.value,
            }
        )
    if errors:
        raise SkillManifestError(*sorted(set(errors)))
    return {"valid": True, "tools": validated, "riskCeiling": manifest.risk_ceiling.value}


def version_satisfies(actual: str, requirement: str) -> bool:
    """匹配精确版本或不跨主版本的 caret 条件。"""

    actual_match = _SEMVER_RE.fullmatch(actual)
    if actual_match is None:
        return False
    actual_parts = tuple(int(part) for part in actual_match.groups())
    if requirement == actual:
        return True
    caret_match = _CARET_RE.fullmatch(requirement)
    if caret_match is None:
        return False
    requested_parts = tuple(int(part or 0) for part in caret_match.groups())
    if actual_parts < requested_parts:
        return False
    major, minor, _patch = requested_parts
    if major > 0:
        return actual_parts[0] == major
    if minor > 0:
        return actual_parts[:2] == (major, minor)
    return actual_parts == requested_parts


def _validate_reference_path(value: str) -> None:
    """只接受仓库内的相对声明路径，不允许把 manifest 指向可执行外部位置。"""

    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not value.strip():
        raise SkillManifestError("SKILL_REFERENCE_PATH_INVALID")
