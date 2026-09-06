"""显式开启时运行真实外部模型的安全两工具演练。"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
from dotenv import dotenv_values

from app.models.agent_run import AgentRun, AgentRunStatus
from app.services import ai_service
from app.services.agent.coordinator import AgentCoordinator
from app.tools.contracts import ToolContext, ToolRisk, ToolSpec
from app.tools.registry import ToolRegistry


def _external_model_key() -> str:
    """读取显式注入或本地开发文件中的演练凭据，且绝不输出其内容。"""

    explicit_key = os.getenv("YUANAI_EXTERNAL_AGENT_DRILL_API_KEY", "").strip()
    if explicit_key:
        return explicit_key
    values = dotenv_values(Path(__file__).parents[2] / ".env")
    configured_key = values.get("DEEPSEEK_API_KEY", "")
    return configured_key.strip() if isinstance(configured_key, str) else ""


def _registry(calls: list[str]) -> ToolRegistry:
    """创建仅含两个无副作用工具的演练注册表。"""

    registry = ToolRegistry()

    async def current_time(
        _arguments: dict[str, object], _context: ToolContext
    ) -> dict[str, object]:
        calls.append("get_current_time")
        return {"timestamp": "2026-01-01T00:00:00+00:00"}

    async def calculate(arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        calls.append("calculate")
        expression = arguments.get("expression")
        if expression != "1+1":
            raise ValueError("unexpected expression")
        return {"result": 2}

    registry.register(
        ToolSpec(
            name="get_current_time",
            description="Return a fixed UTC timestamp.",
            input_schema={"type": "object", "properties": {}, "additionalProperties": False},
            risk_level=ToolRisk.read,
            execution_location="cloud",
        ),
        current_time,
    )
    registry.register(
        ToolSpec(
            name="calculate",
            description="Evaluate exactly the requested arithmetic expression.",
            input_schema={
                "type": "object",
                "properties": {"expression": {"type": "string", "enum": ["1+1"]}},
                "required": ["expression"],
                "additionalProperties": False,
            },
            risk_level=ToolRisk.read,
            execution_location="cloud",
        ),
        calculate,
    )
    return registry


@pytest.mark.asyncio
async def test_external_model_completes_two_safe_tools_when_explicitly_enabled() -> None:
    """真实 provider 被显式授权后必须完成两次无副作用调用再返回结果。"""

    if os.getenv("YUANAI_RUN_EXTERNAL_AGENT_DRILL") != "1":
        pytest.skip("set YUANAI_RUN_EXTERNAL_AGENT_DRILL=1 to allow a billed provider request")
    key = _external_model_key()
    if not key:
        pytest.skip("no external model credential is configured for the drill")

    original_key = ai_service.API_KEYS["deepseek"]
    ai_service.API_KEYS["deepseek"] = key
    ai_service._AI_CLIENTS.pop("deepseek", None)
    calls: list[str] = []
    run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        assistant_id=uuid.uuid4(),
        goal=(
            "Use get_current_time exactly once. Then use calculate exactly once "
            "with expression 1+1. "
            "Do not answer until both tools have returned, then briefly report both results."
        ),
        model="deepseek-v4-flash",
        max_steps=8,
    )
    try:
        result = await AgentCoordinator(tool_registry=_registry(calls)).run(run)
    finally:
        ai_service.API_KEYS["deepseek"] = original_key
        ai_service._AI_CLIENTS.pop("deepseek", None)

    assert result.status is AgentRunStatus.succeeded
    assert calls == ["get_current_time", "calculate"]
