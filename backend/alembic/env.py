import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 导入所有模型以触发 SQLAlchemy 注册，autogenerate 才能检测到表变更
from app.core.database import Base  # noqa: E402
from app.models import (  # noqa: F401, E402
    Conversation,
    ConversationShare,
    File,
    FileUploadSession,
    Message,
    MessageFile,
    PushSubscription,
    User,
)

target_metadata = Base.metadata


def get_url() -> str:
    """优先读取环境变量，兜底使用 alembic.ini 中的 sqlalchemy.url。"""
    from app.core.config import settings

    return settings.database_url


def run_migrations_offline() -> None:
    """离线模式：不需要真实 DB 连接，仅生成 SQL 脚本。"""
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """在线模式：使用 asyncpg 建立异步连接运行迁移。"""
    connectable = create_async_engine(get_url())

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
