import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1 import (
    admin_agent,
    agent,
    auth,
    chat,
    knowledge,
    media,
    memories,
    models,
    notifications,
    qr_login,
    share,
    skills,
    tools,
    voice,
)
from app.api.v1 import files as files_router
from app.core.config import settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期管理。

    Startup：
      - 若使用 S3 后端，确保目标 bucket 存在（MinIO 首次启动时需自动创建）。
    Shutdown：显式关闭所有 AI 单例 client，规避 httpx GC 时的
    ``AsyncHttpxClientWrapper.__del__`` 报错。
    """
    # ── startup ──────────────────────────────────────────────
    from app.services.media_generation_service import run_media_generation_worker
    from app.services.storage_service import storage

    if hasattr(storage, "ensure_bucket"):
        try:
            await storage.ensure_bucket()
        except Exception:
            # 应用启动时 MinIO 可能尚未就绪，稍后请求时再报错即可
            pass
    stop_media_worker = asyncio.Event()
    media_worker = asyncio.create_task(run_media_generation_worker(stop_media_worker))
    yield
    stop_media_worker.set()
    await media_worker
    # ── shutdown ─────────────────────────────────────────────
    from app.services.ai_service import _AI_CLIENTS

    for client in _AI_CLIENTS.values():
        await client.close()
    _AI_CLIENTS.clear()


app = FastAPI(
    title="yuanai API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "yuanai-app://renderer",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# storage_backend=local 时才挂载本地上传目录；S3 走桶自身的 public URL，无需静态挂载
if settings.storage_backend.lower() == "local":
    os.makedirs(settings.local_uploads_dir, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=settings.local_uploads_dir), name="uploads")

app.include_router(auth.router, prefix="/api/v1")
app.include_router(qr_login.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(media.chat_media_router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(share.router, prefix="/api/v1")
app.include_router(files_router.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")
app.include_router(admin_agent.router, prefix="/api/v1")
app.include_router(tools.router, prefix="/api/v1")
app.include_router(memories.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
