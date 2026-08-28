"""ToolRegistry 的有界执行契约测试。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.tools.builtin import build_builtin_registry
from app.tools.contracts import ToolContext, ToolErrorCode, ToolRisk, ToolSpec
from app.tools.registry import ToolRegistry


def _spec(
    name: str = "echo", *, timeout_seconds: int = 30, max_output_bytes: int = 32 * 1024
) -> ToolSpec:
    return ToolSpec(
        name=name,
        description="测试工具",
        input_schema={
            "type": "object",
            "properties": {"value": {"type": "string", "maxLength": 20}},
            "required": ["value"],
            "additionalProperties": False,
        },
        output_schema={"type": "object"},
        risk_level=ToolRisk.read,
        execution_location="cloud",
        timeout_seconds=timeout_seconds,
        max_output_bytes=max_output_bytes,
        idempotent=True,
    )


@pytest.mark.asyncio
async def test_registry_rejects_duplicate_tools_and_lists_specs() -> None:
    registry = ToolRegistry()

    async def echo(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        return {"ok": True}

    registry.register(_spec(), echo)

    with pytest.raises(ValueError, match=ToolErrorCode.DUPLICATE.value):
        registry.register(_spec(), echo)

    assert [spec.name for spec in registry.list_specs()] == ["echo"]
    assert registry.get_spec("echo") == _spec()


@pytest.mark.asyncio
async def test_registry_validates_input_before_handler() -> None:
    registry = ToolRegistry()
    handler = AsyncMock(return_value={"ok": True})
    registry.register(_spec(), handler)

    with pytest.raises(ValueError, match=ToolErrorCode.INVALID_INPUT.value):
        await registry.execute("echo", {"value": 1})
    with pytest.raises(ValueError, match=ToolErrorCode.INVALID_INPUT.value):
        await registry.execute("echo", {"value": "ok", "unexpected": True})
    handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_registry_wraps_timeout_and_handler_errors() -> None:
    registry = ToolRegistry()

    async def slow(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        await asyncio.sleep(0.05)
        return {"ok": True}

    registry.register(_spec("slow", timeout_seconds=0), slow)
    with pytest.raises(RuntimeError, match=ToolErrorCode.TIMEOUT.value):
        await registry.execute("slow", {"value": "ok"})

    async def broken(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        raise RuntimeError("private provider detail")

    registry.register(_spec("broken"), broken)
    with pytest.raises(RuntimeError, match=ToolErrorCode.EXECUTION_FAILED.value) as error:
        await registry.execute("broken", {"value": "ok"})
    assert "private provider detail" not in str(error.value)

    def sync_slow(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        import time

        time.sleep(0.05)
        return {"ok": True}

    registry.register(_spec("sync_slow", timeout_seconds=0), sync_slow)
    with pytest.raises(RuntimeError, match=ToolErrorCode.TIMEOUT.value):
        await registry.execute("sync_slow", {"value": "ok"})


@pytest.mark.asyncio
async def test_registry_rejects_unknown_tool_and_oversized_output() -> None:
    registry = ToolRegistry(max_output_bytes=32)

    with pytest.raises(ValueError, match=ToolErrorCode.NOT_FOUND.value):
        await registry.execute("missing", {})

    async def large(_arguments: dict[str, object], _context: ToolContext) -> dict[str, object]:
        return {"value": "x" * 100}

    registry.register(_spec("large"), large)
    with pytest.raises(RuntimeError, match=ToolErrorCode.OUTPUT_TOO_LARGE.value):
        await registry.execute("large", {"value": "ok"})

    small_registry = ToolRegistry()
    small_registry.register(_spec("small", max_output_bytes=16), large)
    with pytest.raises(RuntimeError, match=ToolErrorCode.OUTPUT_TOO_LARGE.value):
        await small_registry.execute("small", {"value": "ok"})


@pytest.mark.asyncio
async def test_builtin_registry_contains_only_bounded_tools() -> None:
    registry = build_builtin_registry()
    assert [spec.name for spec in registry.list_specs()] == [
        "calculate",
        "get_current_time",
        "inspect_uploaded_file_metadata",
    ]
    assert all(spec.risk_level is ToolRisk.read for spec in registry.list_specs())
    assert all(spec.execution_location == "cloud" for spec in registry.list_specs())
    assert all(spec.idempotent for spec in registry.list_specs())


@pytest.mark.asyncio
async def test_calculate_accepts_bounded_arithmetic_only() -> None:
    registry = build_builtin_registry()
    result = await registry.execute("calculate", {"expression": "(2 + 3) * 4"})
    assert result == {"result": 20}

    with pytest.raises(RuntimeError, match=ToolErrorCode.CALCULATION_FAILED.value):
        await registry.execute("calculate", {"expression": "__import__('os').getcwd()"})
    with pytest.raises(RuntimeError, match=ToolErrorCode.CALCULATION_FAILED.value):
        await registry.execute("calculate", {"expression": "9" * 256})
    with pytest.raises(RuntimeError, match=ToolErrorCode.CALCULATION_FAILED.value):
        await registry.execute("calculate", {"expression": "1000000000 ** 2"})


@pytest.mark.asyncio
async def test_get_current_time_returns_aware_iso_timestamp() -> None:
    registry = build_builtin_registry()
    result = await registry.execute("get_current_time", {"timezone": "UTC"})
    timestamp = datetime.fromisoformat(str(result["datetime"]))
    assert timestamp.tzinfo is not None
    assert result["timezone"] == "UTC"


@pytest.mark.asyncio
async def test_inspect_uploaded_file_metadata_enforces_user_ownership() -> None:
    registry = build_builtin_registry()
    user_id = uuid.uuid4()
    file_id = uuid.uuid4()
    file_row = SimpleNamespace(
        id=file_id,
        user_id=user_id,
        filename="notes.txt",
        mime_type="text/plain",
        size_bytes=42,
        file_hash="a" * 64,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        s3_key="files/private-secret-key",
    )
    db = AsyncMock()
    db_result = SimpleNamespace(scalar_one_or_none=lambda: file_row)
    db.execute.return_value = db_result

    result = await registry.execute(
        "inspect_uploaded_file_metadata",
        {"file_id": str(file_id)},
        context=ToolContext(user_id=user_id, db=db),
    )
    assert result == {
        "file_id": str(file_id),
        "filename": "notes.txt",
        "mime_type": "text/plain",
        "size_bytes": 42,
        "file_hash": "a" * 64,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    assert "s3_key" not in result

    db_result.scalar_one_or_none = lambda: None
    with pytest.raises(RuntimeError, match=ToolErrorCode.FILE_NOT_FOUND.value):
        await registry.execute(
            "inspect_uploaded_file_metadata",
            {"file_id": str(file_id)},
            context=ToolContext(user_id=user_id, db=db),
        )
