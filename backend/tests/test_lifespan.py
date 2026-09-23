"""应用 lifespan 的跨事件循环回归测试。

``ai_service._AI_CLIENTS`` 是进程级单例缓存，而里面的 httpx 连接绑定在创建它的
事件循环上。一个 lifespan 只拥有自己这轮建出来的 client，关闭阶段不能去关别的
循环留下的那些，否则会抛 ``RuntimeError: Event loop is closed``。
"""

from typing import cast

from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from app.main import app
from app.services.ai_service import _AI_CLIENTS


class _ClientFromAClosedLoop:
    """模拟上一轮事件循环留下的 AI client。"""

    async def close(self) -> None:
        """还原真实行为：在已关闭的循环上关 keep-alive 连接必然失败。"""
        raise RuntimeError("Event loop is closed")


def test_lifespan_discards_ai_clients_left_by_a_previous_event_loop() -> None:
    """启动阶段必须丢弃上一轮循环的 client，关闭阶段才不会炸在它身上。"""
    _AI_CLIENTS["stale"] = cast(AsyncOpenAI, _ClientFromAClosedLoop())
    try:
        with TestClient(app):
            assert "stale" not in _AI_CLIENTS
    finally:
        _AI_CLIENTS.clear()
