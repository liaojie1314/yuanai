"""Skill manifest 校验的纯单元覆盖。"""

import pytest

from app.services.skill_validation import (
    SkillManifestError,
    parse_manifest,
    validate_manifest_tools,
    version_satisfies,
)
from app.tools.contracts import ToolContext, ToolRisk, ToolSpec
from app.tools.registry import ToolRegistry


def _manifest(*, required_tools: str = "  - calculate@^1", risk: str = "read") -> str:
    return f"""id: yuanai.research.brief
version: 1.0.0
name: Research Brief
description: Build a cited brief
entrypoint: SKILL.md
required_tools:
{required_tools}
risk_ceiling: {risk}
"""


async def _handler(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
    return {"result": 1}


def _registry(*, version: str = "1.2.0", risk: ToolRisk = ToolRisk.read) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="calculate",
            version=version,
            description="Calculate",
            input_schema={"type": "object"},
            risk_level=risk,
            execution_location="cloud",
        ),
        _handler,
    )
    return registry


def test_manifest_parses_only_declared_fields() -> None:
    """安全 YAML 只接受固定 manifest 字段。"""

    manifest = parse_manifest(_manifest(), "# Instructions")
    assert manifest.id == "yuanai.research.brief"
    assert manifest.required_tools == ["calculate@^1"]

    with pytest.raises(SkillManifestError, match="SKILL_MANIFEST_INVALID"):
        parse_manifest(_manifest() + "scripts: run.sh\n", "# Instructions")


@pytest.mark.parametrize(
    ("actual", "requirement", "expected"),
    [
        ("1.0.0", "1.0.0", True),
        ("1.2.0", "^1", True),
        ("1.2.0", "^1.1", True),
        ("2.0.0", "^1", False),
        ("1.0.0", "^1.1", False),
        ("1.0.0", "invalid", False),
    ],
)
def test_version_satisfies_exact_and_caret(actual: str, requirement: str, expected: bool) -> None:
    """工具版本只能匹配精确或受限 caret 声明。"""

    assert version_satisfies(actual, requirement) is expected


def test_manifest_rejects_missing_tool_and_insufficient_risk() -> None:
    """manifest 不能引用未注册工具，也不能把写工具伪装为 read。"""

    with pytest.raises(SkillManifestError, match="SKILL_TOOL_NOT_FOUND"):
        validate_manifest_tools(
            parse_manifest(_manifest(required_tools="  - missing@^1"), "# Instructions"),
            _registry(),
        )

    with pytest.raises(SkillManifestError, match="SKILL_RISK_CEILING_TOO_LOW"):
        validate_manifest_tools(
            parse_manifest(_manifest(), "# Instructions"),
            _registry(risk=ToolRisk.local_write),
        )


def test_manifest_records_validated_registered_tool() -> None:
    """通过的声明只记录 Registry 已知工具及其实际版本。"""

    result = validate_manifest_tools(parse_manifest(_manifest(), "# Instructions"), _registry())
    assert result == {
        "valid": True,
        "tools": [{"name": "calculate", "version": "1.2.0", "riskLevel": "read"}],
        "riskCeiling": "read",
    }
