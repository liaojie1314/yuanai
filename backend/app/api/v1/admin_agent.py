"""只读 Agent 运维摘要 API。"""

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.models.agent_run import AgentRun

router = APIRouter(prefix="/admin/agent-runs", tags=["admin-agent"])


def _require_admin(user_id: uuid.UUID) -> None:
    """只允许配置的运营用户读取脱敏 Agent 摘要。"""
    allowed = {item.strip() for item in settings.agent_admin_user_ids.split(",") if item.strip()}
    if str(user_id) not in allowed:
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("")
async def list_agent_run_summaries(current_user: CurrentUser, db: DB) -> list[dict[str, object]]:
    _require_admin(current_user.id)
    rows = await db.scalars(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(100))
    return [
        {
            "id": str(run.id),
            "status": run.status.value,
            "model": run.model,
            "createdAt": run.created_at,
            "currentStep": run.current_step,
            "errorCode": run.error_code,
        }
        for run in rows
    ]


@router.get("/{run_id}")
async def get_agent_run_summary(
    run_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> dict[str, object]:
    _require_admin(current_user.id)
    run = await db.scalar(select(AgentRun).where(AgentRun.id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return {
        "id": str(run.id),
        "user_id": str(run.user_id),
        "status": run.status.value,
        "model": run.model,
        "currentStep": run.current_step,
        "errorCode": run.error_code,
        "createdAt": run.created_at,
        "updatedAt": run.updated_at,
    }
