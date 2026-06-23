from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.services.ai_service import AVAILABLE_MODELS

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models(current_user: CurrentUser) -> dict:
    return {"models": AVAILABLE_MODELS}
