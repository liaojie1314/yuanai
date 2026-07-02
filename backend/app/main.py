from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, chat, models


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。

    Startup：当前无需初始化（AI client 采用懒加载单例）。
    Shutdown：在 event loop 仍健康运行时显式关闭所有 AI 单例 client。

    背景：
        若不在此处关闭，Python 解释器退出时 GC 会触发
        AsyncHttpxClientWrapper.__del__，该方法调度
          asyncio.get_running_loop().create_task(self.aclose())
        但此时 event loop 处于"可获取但已关闭"的中间态，task 运行时
        httpx 内部 _transport 已被部分回收，导致：
          AttributeError: 'AsyncHttpxClientWrapper' object has no attribute '_transport'
          Task exception was never retrieved
        在此处 await client.close() 后，_state 被设为 CLOSED，
        后续 __del__ 执行 if self.is_closed: return，彻底静默。
    """
    # ── startup ──────────────────────────────────────────────
    yield
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
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
