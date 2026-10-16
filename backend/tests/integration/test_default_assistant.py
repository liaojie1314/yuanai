"""默认助理的懒建、幂等与并发竞争。"""

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.agent import list_assistants
from app.models.assistant import Assistant
from app.models.user import User
from app.services.assistant_service import DEFAULT_ASSISTANT_MODEL, ensure_default_assistant
from tests.conftest import TEST_DATABASE_URL


def test_default_assistant_model_is_routable() -> None:
    """默认助理的模型必须能路由到供应商，否则新用户一开口就失败。"""

    from app.services.ai_service import PROVIDER_CONFIG

    assert DEFAULT_ASSISTANT_MODEL in PROVIDER_CONFIG


@pytest.mark.asyncio
async def test_list_assistants_creates_default_for_new_user(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """新用户第一次打开助理列表就能拿到一个默认助理，而不是空列表。"""

    response = await client.get("/api/v1/agent/assistants", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["isDefault"] is True


@pytest.mark.asyncio
async def test_ensure_default_assistant_is_idempotent(db: AsyncSession, test_user: User) -> None:
    """重复调用不会造出第二个助理。"""

    first = await ensure_default_assistant(user_id=test_user.id, db=db)
    second = await ensure_default_assistant(user_id=test_user.id, db=db)
    assert first.id == second.id
    total = await db.scalar(
        select(func.count()).select_from(Assistant).where(Assistant.user_id == test_user.id)
    )
    assert total == 1


@pytest.mark.asyncio
async def test_concurrent_ensure_yields_single_default(db: AsyncSession, test_user: User) -> None:
    """并发打开助理列表时唯一索引兜住竞争，不会出现两个默认助理。

    必须用彼此独立的 session：``client`` fixture 把同一个 AsyncSession 注入所有请求，
    在它上面并发等于复用一条连接，测不出真正的竞争。
    """

    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def list_with_independent_session() -> list[Assistant]:
            async with session_factory() as session:
                return await list_assistants(test_user, session)

        await asyncio.gather(*(list_with_independent_session() for _ in range(4)))
    finally:
        await engine.dispose()

    defaults = await db.scalar(
        select(func.count())
        .select_from(Assistant)
        .where(Assistant.user_id == test_user.id, Assistant.is_default.is_(True))
    )
    assert defaults == 1
