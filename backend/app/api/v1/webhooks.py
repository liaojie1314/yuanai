"""自动化 Webhook 的公网入口与带认证的管理 API。

`POST /webhooks/{public_id}` 与其余接口的关键差别是**没有认证依赖**：它是第三方系统
调用的公网端点，身份完全由请求头中的 HMAC 签名证明。管理侧（创建、查看、轮换、删除）
仍挂在 `/automations/{automation_id}/webhook` 下并沿用普通用户认证。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps import DB, CurrentUser
from app.models.automation import WebhookEndpoint
from app.schemas.automation import (
    WebhookEndpointCreate,
    WebhookEndpointResponse,
    WebhookEndpointSecretResponse,
)
from app.services.agent.queue import AgentQueue
from app.services.automation_service import (
    AgentUnavailableError,
    AutomationNotFoundError,
    AutomationStateError,
)
from app.services.secret_store import TenantSecretStore
from app.services.webhook_service import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    WebhookEndpointNotFoundError,
    WebhookError,
    WebhookGuard,
    WebhookGuardUnavailableError,
    WebhookPayloadInvalidError,
    WebhookPayloadTooLargeError,
    WebhookRateLimitedError,
    WebhookReplayDetectedError,
    WebhookSecret,
    WebhookSecretUnavailableError,
    WebhookSignatureInvalidError,
    WebhookSignatureRequiredError,
    WebhookStateError,
    WebhookTimestampInvalidError,
    create_webhook_endpoint,
    delete_webhook_endpoint,
    deliver_webhook_event,
    get_webhook_endpoint,
    rotate_webhook_secret,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
automation_router = APIRouter(prefix="/automations", tags=["automations"])


def get_webhook_guard() -> WebhookGuard:
    """提供 Webhook 重放与限流守卫，便于测试替换存储实现。"""

    return WebhookGuard()


def get_webhook_secret_store() -> TenantSecretStore:
    """提供 Webhook 签名密钥的凭证存储，便于测试替换会话工厂。"""

    return TenantSecretStore()


def get_webhook_queue() -> AgentQueue:
    """提供标准 Agent Run 队列，便于测试替换 Redis 连接。"""

    return AgentQueue()


WebhookGuardDep = Annotated[WebhookGuard, Depends(get_webhook_guard)]
WebhookStoreDep = Annotated[TenantSecretStore, Depends(get_webhook_secret_store)]
WebhookQueueDep = Annotated[AgentQueue, Depends(get_webhook_queue)]


def _error_response(error: WebhookError) -> HTTPException:
    """把服务的稳定错误码映射到 HTTP 响应。"""

    return HTTPException(status_code=error.status_code, detail=error.code)


def _secret_response(result: WebhookSecret) -> WebhookEndpointSecretResponse:
    """把一次性密钥响应与需要脱敏的元数据拼在一起。"""

    payload = WebhookEndpointResponse.model_validate(result.endpoint)
    return WebhookEndpointSecretResponse(**payload.model_dump(), secret=result.secret)


@router.post("/{public_id}", status_code=202)
async def receive_event(
    public_id: str,
    request: Request,
    db: DB,
    guard: WebhookGuardDep,
    store: WebhookStoreDep,
    queue: WebhookQueueDep,
) -> dict[str, str]:
    """接收第三方签名事件并触发一次标准 Agent Run。

    这个端点没有任何认证依赖，因此不能假设请求来自可信方：签名、时间戳窗口、
    重放登记和限流全部在服务层完成，任何一步失败都不创建 Run。响应体只回最小信息，
    不回显 payload 内容，避免把外部数据变成反射面。
    """

    body = await request.body()
    try:
        automation_run = await deliver_webhook_event(
            public_id=public_id,
            body=body,
            signature=request.headers.get(SIGNATURE_HEADER),
            timestamp=request.headers.get(TIMESTAMP_HEADER),
            db=db,
            guard=guard,
            store=store,
            queue=queue,
        )
    except (
        WebhookEndpointNotFoundError,
        WebhookSignatureRequiredError,
        WebhookTimestampInvalidError,
        WebhookSignatureInvalidError,
        WebhookReplayDetectedError,
        WebhookRateLimitedError,
        WebhookGuardUnavailableError,
        WebhookSecretUnavailableError,
        WebhookPayloadTooLargeError,
        WebhookPayloadInvalidError,
    ) as error:
        raise _error_response(error) from error
    except AutomationStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except AgentUnavailableError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"automationRunId": str(automation_run.id), "status": automation_run.status.value}


@automation_router.post(
    "/{automation_id}/webhook",
    response_model=WebhookEndpointSecretResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_webhook(
    automation_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    store: WebhookStoreDep,
    request: WebhookEndpointCreate | None = None,
) -> WebhookEndpointSecretResponse:
    """为一个 webhook 触发型自动化创建入口，密钥明文只在此响应中出现一次。"""

    try:
        result = await create_webhook_endpoint(
            automation_id=automation_id,
            user_id=current_user.id,
            db=db,
            rate_limit_per_minute=request.rate_limit_per_minute if request else None,
            store=store,
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except WebhookStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except WebhookSecretUnavailableError as error:
        raise _error_response(error) from error
    return _secret_response(result)


@automation_router.get("/{automation_id}/webhook", response_model=WebhookEndpointResponse)
async def read_webhook(
    automation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> WebhookEndpoint:
    """读取入口元数据；响应里永远没有密钥，只有用于辨认的前缀。"""

    try:
        return await get_webhook_endpoint(
            automation_id=automation_id, user_id=current_user.id, db=db
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except WebhookEndpointNotFoundError as error:
        raise _error_response(error) from error


@automation_router.post(
    "/{automation_id}/webhook/rotate", response_model=WebhookEndpointSecretResponse
)
async def rotate_webhook(
    automation_id: uuid.UUID, current_user: CurrentUser, db: DB, store: WebhookStoreDep
) -> WebhookEndpointSecretResponse:
    """换发签名密钥；旧密钥立即失效，用于泄漏后的应急轮换。"""

    try:
        result = await rotate_webhook_secret(
            automation_id=automation_id, user_id=current_user.id, db=db, store=store
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except WebhookEndpointNotFoundError as error:
        raise _error_response(error) from error
    except WebhookSecretUnavailableError as error:
        raise _error_response(error) from error
    return _secret_response(result)


@automation_router.delete("/{automation_id}/webhook", status_code=status.HTTP_204_NO_CONTENT)
async def remove_webhook(
    automation_id: uuid.UUID, current_user: CurrentUser, db: DB, store: WebhookStoreDep
) -> Response:
    """删除入口；public_id 立即失效，后续投递返回 404。"""

    try:
        await delete_webhook_endpoint(
            automation_id=automation_id, user_id=current_user.id, db=db, store=store
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except WebhookEndpointNotFoundError as error:
        raise _error_response(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)
