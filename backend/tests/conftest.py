"""测试配置 — 全局 fixtures。

使用 NullPool 禁用连接池，确保每次 DB 操作都获得独立连接，
彻底避免 pytest-asyncio 不同事件循环间共享 asyncpg 连接的冲突。
"""

import asyncio
import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

os.environ["DATABASE_URL"] = "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests"
os.environ["REDIS_URL"] = "redis://localhost:6379/1"

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402

TEST_DATABASE_URL = "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test"

# NullPool：不使用连接池，每次获取新连接，避免跨 event loop 共享连接
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

_TRUNCATE_SQL = text(
    "TRUNCATE TABLE message_files, messages, files, conversations, users RESTART IDENTITY CASCADE"
)


def pytest_sessionstart(session: pytest.Session) -> None:
    """同步钩子：所有测试开始前创建数据库表（独立 asyncio.run，不影响测试 event loop）。"""
    async def _create():
        engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(_create())


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """同步钩子：所有测试结束后删除数据库表。"""
    async def _drop():
        engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_drop())


@pytest.fixture(autouse=True)
def mock_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock Redis 避免跨 event loop 共享连接问题。存储为字典模拟 KV 行为。"""
    from unittest.mock import AsyncMock

    import app.services.auth_service as svc

    store: dict[str, str] = {}

    async def fake_setex(key: str, ttl: int, value: str) -> bool:
        store[key] = value
        return True

    async def fake_get(key: str) -> str | None:
        return store.get(key)

    async def fake_delete(key: str) -> int:
        return store.pop(key, None) and 1 or 0  # type: ignore[return-value]

    mock = AsyncMock()
    mock.setex.side_effect = fake_setex
    mock.get.side_effect = fake_get
    mock.delete.side_effect = fake_delete

    monkeypatch.setattr(svc, "redis_client", mock)


@pytest.fixture(autouse=True)
async def truncate_tables() -> AsyncGenerator[None, None]:
    """每个测试结束后 TRUNCATE 所有表，保证数据隔离。"""
    yield
    async with TestSessionLocal() as session:
        await session.execute(_TRUNCATE_SQL)
        await session.commit()


@pytest.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """提供测试专用 DB session（NullPool，每次独立连接）。"""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """注入测试 DB 的 HTTP 客户端，覆盖 get_db 依赖。"""
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def test_user(db: AsyncSession) -> User:
    """创建并持久化测试用户（密码: Test1234!）。"""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        username="testuser",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    """返回携带有效 access token 的 Authorization 头。"""
    token = create_access_token(str(test_user.id))
    return {"Authorization": f"Bearer {token}"}
