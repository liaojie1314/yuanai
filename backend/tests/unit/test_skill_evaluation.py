"""Skill 版本静态契约评测用例与经验归纳聚类的单元覆盖。"""

import uuid

from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.skill import SkillVersion
from app.services.skill_evaluation import run_static_contract_cases
from app.services.skill_experience import _cluster_runs
from app.services.skill_validation import content_digest
from app.tools.builtin import build_phase6_registry
from app.tools.contracts import ToolRisk

_SKILL_MD = "# Research Brief\n按步骤调用 `calculate` 得到结果。"


def _manifest(*, version: str = "1.0.0", tool: str = "calculate@^1", risk: str = "read") -> str:
    return f"""id: yuanai.research.brief
version: {version}
name: Research Brief
description: Build a cited brief
entrypoint: SKILL.md
required_tools:
  - {tool}
risk_ceiling: {risk}
"""


def _version(
    *,
    manifest_text: str | None = None,
    skill_md: str = _SKILL_MD,
    version: str = "1.0.0",
    risk_ceiling: ToolRisk = ToolRisk.read,
    content_hash: str | None = None,
) -> SkillVersion:
    """构造未入库的版本对象；评测用例是纯函数，不需要会话。"""

    text = manifest_text if manifest_text is not None else _manifest(version=version)
    return SkillVersion(
        id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        version=version,
        manifest_text=text,
        skill_md=skill_md,
        content_hash=content_hash or content_digest(text, skill_md),
        required_tools=["calculate@^1"],
        risk_ceiling=risk_ceiling,
    )


def _results(
    version: SkillVersion, active_version: SkillVersion | None = None
) -> dict[str, tuple[bool, str]]:
    cases = run_static_contract_cases(
        version=version, active_version=active_version, registry=build_phase6_registry()
    )
    return {case.name: (case.passed, case.detail) for case in cases}


def test_clean_version_passes_every_static_case() -> None:
    """声明自洽的版本必须整套用例全通过。"""

    results = _results(_version())
    assert all(passed for passed, _ in results.values()), results
    assert set(results) == {
        "manifest_contract",
        "content_integrity",
        "tool_contract",
        "declared_tool_coverage",
        "risk_ceiling_not_escalated",
        "secret_scan",
    }


def test_unparsable_manifest_fails_dependent_cases_instead_of_skipping() -> None:
    """manifest 解析失败时依赖用例必须判失败，否则通过率会虚高。"""

    results = _results(_version(manifest_text="id: [不是对象"))
    assert results["manifest_contract"][0] is False
    assert results["tool_contract"][0] is False
    assert results["declared_tool_coverage"][0] is False
    # 不依赖 manifest 的用例仍要如实给出结论。
    assert results["secret_scan"][0] is True
    assert len(results) == 6


def test_tampered_content_fails_integrity_case() -> None:
    """落库后被改写的版本内容必须被指纹比对拦下。"""

    results = _results(_version(content_hash="0" * 64))
    assert results["content_integrity"][0] is False


def test_undeclared_tool_reference_in_instructions_fails() -> None:
    """指令里反引号引用了未声明的工具时判失败，避免绕过风险上限。"""

    results = _results(_version(skill_md="# Brief\n先 `calculate`，再用 `memory.delete` 清理。"))
    assert results["declared_tool_coverage"][0] is False
    assert "memory.delete" in results["declared_tool_coverage"][1]


def test_prose_mention_without_backticks_does_not_trigger_coverage_case() -> None:
    """散文里出现同名单词不算工具调用，避免误判。"""

    results = _results(_version(skill_md="# Brief\nPlease calculate the total and `calculate` it."))
    assert results["declared_tool_coverage"][0] is True


def test_inline_credential_fails_secret_scan_without_echoing_value() -> None:
    """内联凭据必须判失败，且 detail 不回显命中的内容。"""

    secret = "sk-" + "a" * 32
    results = _results(_version(skill_md=f"# Brief\n用 `calculate`，Key 是 {secret}"))
    passed, detail = results["secret_scan"]
    assert passed is False
    assert secret not in detail


def test_risk_ceiling_escalation_fails_against_active_version() -> None:
    """新版本抬高风险上限等于静默扩权，必须判失败。"""

    active = _version()
    escalated = _version(
        manifest_text=_manifest(version="1.1.0", risk="privileged"),
        version="1.1.0",
        risk_ceiling=ToolRisk.privileged,
    )
    assert _results(escalated, active)["risk_ceiling_not_escalated"][0] is False
    # 收紧上限和没有 active 版本都应放行。
    assert _results(active, escalated)["risk_ceiling_not_escalated"][0] is True
    assert _results(escalated, None)["risk_ceiling_not_escalated"][0] is True


def _run(goal: str) -> AgentRun:
    """构造一次只有目标文本的成功 Run，用于验证聚类阈值。"""

    run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        assistant_id=uuid.uuid4(),
        goal=goal,
        status=AgentRunStatus.succeeded,
        model="deepseek-chat",
    )
    run.steps = [
        AgentStep(
            run_id=run.id,
            sequence=1,
            kind=AgentStepKind.tool,
            status=AgentStepStatus.succeeded,
            input_json={"name": "calculate", "arguments": {"expression": goal}},
        )
    ]
    return run


def test_cluster_keeps_chinese_goals_sharing_one_character_apart() -> None:
    """只共享单个汉字的目标不能聚成一类，否则候选会把不同任务混在一起。"""

    clusters = _cluster_runs([_run("写周报"), _run("写邮件"), _run("写周报")])
    assert sorted(len(cluster.runs) for cluster in clusters) == [1, 2]


def test_cluster_groups_goals_differing_only_in_parameters() -> None:
    """只有参数不同的同类任务必须聚成一类。"""

    clusters = _cluster_runs(
        [
            _run("统计第 1 周销售额并汇总"),
            _run("统计第 2 周销售额并汇总"),
            _run("统计第 3 周销售额并汇总"),
        ]
    )
    assert [len(cluster.runs) for cluster in clusters] == [3]
