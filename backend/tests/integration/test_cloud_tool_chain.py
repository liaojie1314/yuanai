"""云端只读工具和 Artifact 产出链路的集成测试。"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentEvent, AgentRun, Assistant, Conversation
from app.models.agent_run import AgentRunStatus
from app.models.tool_runtime import Artifact, ToolExecution, ToolExecutionStatus
from app.services.agent.coordinator import AgentCoordinator
from app.services.agent.event_service import EventStore
from app.services.ai_service import (
    ContentDelta,
    ModelCompleted,
    ModelEvent,
    ToolCallArgumentsDelta,
    ToolCallEnd,
    ToolCallStart,
)
from app.services.tools.search import SearchSource
from app.tools.builtin import build_phase6_registry


@dataclass
class CloudChainModel:
    """按四个云端工具步骤返回确定性的 provider-neutral 事件。"""

    calls: int = 0

    async def __call__(
        self,
        _model: str,
        _messages: list[dict[str, object]],
        _tools: list[dict[str, object]],
        *,
        enable_thinking: bool = False,
    ) -> AsyncGenerator[ModelEvent, None]:
        del enable_thinking
        self.calls += 1
        if self.calls == 1:
            for event in self._tool("search", "web_search", {"query": "yuanai"}):
                yield event
        elif self.calls == 2:
            for event in self._tool(
                "extract", "web_extract", {"url": "https://example.com/report"}
            ):
                yield event
        elif self.calls == 3:
            for event in self._tool("analyze", "code_execute_python", {"code": "2 + 3"}):
                yield event
        elif self.calls == 4:
            for event in self._tool(
                "report",
                "files_write",
                {
                    "name": "yuanai-report.md",
                    "mime_type": "text/markdown",
                    "content": "# YuanAI\n\n分析结果：5",
                },
            ):
                yield event
        else:
            yield ContentDelta(token="报告已生成")
            yield ModelCompleted()

    @staticmethod
    def _tool(tool_id: str, name: str, arguments: dict[str, object]) -> list[ModelEvent]:
        """构造一次完整工具调用。"""

        return [
            ToolCallStart(tool_call_id=tool_id, name=name),
            ToolCallArgumentsDelta(
                tool_call_id=tool_id,
                args_chunk=json.dumps(arguments, ensure_ascii=False),
            ),
            ToolCallEnd(tool_call_id=tool_id),
            ModelCompleted(finish_reason="tool_calls"),
        ]


@pytest.mark.asyncio
async def test_agent_completes_search_extract_analyze_report_chain(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Agent 能串联搜索、网页提取、隔离分析和报告 Artifact。"""

    async def fake_search_web(*, user_id: uuid.UUID, query: str) -> list[SearchSource]:
        assert user_id == test_user.id
        assert query == "yuanai"
        return [
            SearchSource(
                title="YuanAI report",
                url="https://example.com/report",
                snippet="公开摘要",
                provider="searxng",
            )
        ]

    async def fake_fetch_public_html(url: str) -> tuple[str, str]:
        assert url == "https://example.com/report"
        return url, "<html><title>Report</title><body>公开正文</body></html>"

    monkeypatch.setattr("app.tools.builtin.phase6.search_web", fake_search_web)
    monkeypatch.setattr("app.tools.builtin.phase6.fetch_public_html", fake_fetch_public_html)

    assistant = Assistant(
        user_id=test_user.id,
        name="Cloud chain",
        default_model="test-model",
        is_default=True,
    )
    conversation = Conversation(user_id=test_user.id, model="test-model")
    db.add_all([assistant, conversation])
    await db.flush()
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        conversation_id=conversation.id,
        goal="搜索资料并生成报告",
        model="test-model",
        max_steps=12,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run, ["steps"])

    async def persist_event(event: AgentEvent) -> AgentEvent:
        """让链路测试隔离事件存储会话，只验证事件序列和内容。"""

        return event

    event_store = EventStore(persist=persist_event)
    model = CloudChainModel()
    coordinator = AgentCoordinator(
        model_stream=model,
        tool_registry=build_phase6_registry(),
        event_store=event_store,
    )
    result = await coordinator.run(run, db=db)
    await db.commit()

    executions = list(
        (
            await db.scalars(
                select(ToolExecution)
                .where(ToolExecution.run_id == run.id)
                .order_by(ToolExecution.created_at)
            )
        ).all()
    )
    artifacts = list((await db.scalars(select(Artifact).where(Artifact.run_id == run.id))).all())
    events = await event_store.replay(run.id)

    assert result.status is AgentRunStatus.succeeded
    assert result.content == "报告已生成"
    assert model.calls == 5
    assert [item.tool_name for item in executions] == [
        "web_search",
        "web_extract",
        "code_execute_python",
        "files_write",
    ]
    assert all(item.status is ToolExecutionStatus.succeeded for item in executions)
    assert len(artifacts) == 1
    assert artifacts[0].mime_type == "text/markdown"
    assert artifacts[0].tool_execution_id == executions[-1].id
    assert any(event.event_type == "tool_completed" for event in events)
