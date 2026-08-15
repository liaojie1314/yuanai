"""扫码登录挑战的 HTTP 路由。"""

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Response

from app.api.deps import DB, CurrentUser
from app.schemas.auth import AuthResponse
from app.schemas.qr_login import (
    QRLoginCreateRequest,
    QRLoginCreateResponse,
    QRLoginExchangeRequest,
    QRLoginInspectResponse,
    QRLoginStatusResponse,
)
from app.services import qr_login_service
from app.services.qr_login_service import QRLoginServiceError

router = APIRouter(prefix="/auth/qr-login", tags=["qr-login"])


def _error_to_http(error: QRLoginServiceError) -> HTTPException:
    """将领域错误映射为不会泄露凭据的稳定 API 响应。"""
    status_code = {
        "QR_LOGIN_NOT_FOUND": 404,
        "QR_LOGIN_FORBIDDEN": 403,
        "QR_LOGIN_EXPIRED": 410,
        "QR_LOGIN_RATE_LIMITED": 429,
        "QR_LOGIN_CONSUMED": 409,
        "QR_LOGIN_NOT_PENDING": 409,
        "QR_LOGIN_NOT_APPROVED": 409,
        "QR_LOGIN_INVALID_CODE": 401,
        "QR_LOGIN_INVALID_API_BASE_URL": 400,
    }.get(error.code, 400)
    return HTTPException(status_code, {"code": error.code, "message": "扫码登录请求无效"})


@router.post("/challenges", response_model=QRLoginCreateResponse, status_code=201)
async def create_qr_login_challenge(
    req: QRLoginCreateRequest, request: Request, db: DB
) -> QRLoginCreateResponse:
    """由 Web 或桌面目标设备创建可扫码的短时挑战。"""
    request_key = request.client.host if request.client is not None else "unknown"
    try:
        return await qr_login_service.create_challenge(
            request=req, request_key=request_key, db=db
        )
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error


@router.get("/challenges/{challenge}/inspect", response_model=QRLoginInspectResponse)
async def inspect_qr_login_challenge(
    challenge: str, current_user: CurrentUser, db: DB
) -> QRLoginInspectResponse:
    """由已登录手机读取确认登录前的目标设备信息。"""
    try:
        return await qr_login_service.inspect_challenge(
            challenge=challenge, user=current_user, db=db
        )
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error


@router.post("/challenges/{challenge}/approve", status_code=204)
async def approve_qr_login_challenge(
    challenge: str, current_user: CurrentUser, db: DB
) -> Response:
    """由已登录手机明确批准目标设备登录。"""
    try:
        await qr_login_service.approve_challenge(challenge=challenge, user=current_user, db=db)
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error
    return Response(status_code=204)


@router.post("/challenges/{challenge}/deny", status_code=204)
async def deny_qr_login_challenge(
    challenge: str, current_user: CurrentUser, db: DB
) -> Response:
    """由已登录手机明确拒绝目标设备登录。"""
    try:
        await qr_login_service.deny_challenge(challenge=challenge, user=current_user, db=db)
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error
    return Response(status_code=204)


@router.get("/challenges/{challenge}/status", response_model=QRLoginStatusResponse)
async def get_qr_login_status(
    challenge: str,
    poll_secret: Annotated[str, Header(alias="X-QR-Poll-Secret")],
    db: DB,
) -> QRLoginStatusResponse:
    """仅允许目标端持 polling secret 查询挑战状态。"""
    try:
        return await qr_login_service.get_target_status(
            challenge=challenge, poll_secret=poll_secret, db=db
        )
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error


@router.post("/exchange", response_model=AuthResponse)
async def exchange_qr_login_challenge(req: QRLoginExchangeRequest, db: DB) -> AuthResponse:
    """用挑战、轮询 secret 和一次性授权码换取常规登录会话。"""
    try:
        return await qr_login_service.exchange_challenge(request=req, db=db)
    except QRLoginServiceError as error:
        raise _error_to_http(error) from error
