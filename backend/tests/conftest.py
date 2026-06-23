"""
测试配置 — 提供共享 fixtures。

集成测试需要真实数据库，运行前确保：
  1. docker-compose up -d
  2. 在 backend/ 目录下设置 .env（或导出环境变量）

单元测试可独立运行，不依赖数据库/Redis。
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client() -> AsyncClient:
    """提供一个与 ASGI app 绑定的 AsyncClient（不启动真实服务器）。"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
