from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.services.ai_service import get_available_models

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models(current_user: CurrentUser) -> dict[str, object]:
    return {"models": get_available_models()}
