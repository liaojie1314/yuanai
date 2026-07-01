#!/usr/bin/env bash
# 元AI — 一键启动全栈开发环境（真实接口模式）[仅 macOS / Linux]
# Windows 用户请使用：pnpm dev:real（自动调用跨平台的 Node.js 版本）
# 用法：bash scripts/dev.sh（直接调用）
#       pnpm dev:real（等价，任何平台均可）

set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*"; exit 1; }
step() { echo -e "\n${BOLD}$*${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_ENV="$ROOT_DIR/apps/web/.env.local"

BACKEND_PID=

# ── 清理：退出时（包括 Ctrl+C）停止后端 ─────────────────────────────────
cleanup() {
  echo ""
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "停止后端（PID $BACKEND_PID）..."
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  log "已退出。"
}
trap cleanup EXIT

# ════════════════════════════════════════════════════════════════════════
step "【1/6】检查先决条件"
# ════════════════════════════════════════════════════════════════════════

command -v docker >/dev/null 2>&1 || err "未找到 docker，请先安装 Docker Desktop / Docker Engine"
docker info >/dev/null 2>&1      || err "Docker 未运行，请先启动 Docker Desktop"
command -v uv   >/dev/null 2>&1  || err "未找到 uv，请先安装：curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v pnpm >/dev/null 2>&1  || err "未找到 pnpm，请先安装：npm install -g pnpm"
ok "先决条件通过"

# ════════════════════════════════════════════════════════════════════════
step "【2/6】检查环境变量配置"
# ════════════════════════════════════════════════════════════════════════

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  warn "backend/.env 不存在，正在从 .env.example 复制..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo ""
  echo -e "${YELLOW}┌──────────────────────────────────────────────────────────┐${NC}"
  echo -e "${YELLOW}│  请在 backend/.env 中填写至少一个 AI 提供商的 API Key：  │${NC}"
  echo -e "${YELLOW}│                                                          │${NC}"
  echo -e "${YELLOW}│  DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx   ← 推荐，有免费额度  │${NC}"
  echo -e "${YELLOW}│  OPENAI_API_KEY=sk-proj-xxxxxxxxx                       │${NC}"
  echo -e "${YELLOW}│  ANTHROPIC_API_KEY=sk-ant-xxxxxxxx                      │${NC}"
  echo -e "${YELLOW}│                                                          │${NC}"
  echo -e "${YELLOW}│  详细说明：docs/ai-providers.md                          │${NC}"
  echo -e "${YELLOW}└──────────────────────────────────────────────────────────┘${NC}"
  echo ""
  read -rp "  填写完毕后按回车继续，或按 Ctrl+C 退出... " _
fi

# 写入前端 env（强制真实接口模式，移除 MOCK 标记）
{
  grep -v "NEXT_PUBLIC_MOCK\|NEXT_PUBLIC_API_URL" "$WEB_ENV" 2>/dev/null || true
  echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1"
} > "${WEB_ENV}.tmp" && mv "${WEB_ENV}.tmp" "$WEB_ENV"
ok "前端已配置为真实接口模式"

# ════════════════════════════════════════════════════════════════════════
step "【3/6】启动 Docker 基础设施"
# ════════════════════════════════════════════════════════════════════════

log "启动 PostgreSQL + Redis + MinIO..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

# 等待 PostgreSQL 就绪（最多 30 秒）
log "等待 PostgreSQL 就绪..."
WAITED=0
until docker compose -f "$ROOT_DIR/docker-compose.yml" \
      exec -T postgres pg_isready -U yuanai -d yuanai >/dev/null 2>&1; do
  WAITED=$((WAITED + 1))
  [[ $WAITED -ge 30 ]] && err "PostgreSQL 启动超时（30s），请运行 docker compose ps 检查状态"
  printf "."
  sleep 1
done
echo ""
ok "PostgreSQL 就绪"

# ════════════════════════════════════════════════════════════════════════
step "【4/6】数据库迁移"
# ════════════════════════════════════════════════════════════════════════

log "执行 alembic upgrade head..."
cd "$BACKEND_DIR"
uv run alembic upgrade head
cd "$ROOT_DIR"
ok "数据库迁移完成"

# ════════════════════════════════════════════════════════════════════════
step "【5/6】启动后端"
# ════════════════════════════════════════════════════════════════════════

log "启动 FastAPI（http://localhost:8000）..."
cd "$BACKEND_DIR"
uv run uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!
cd "$ROOT_DIR"

# 等待后端健康检查（最多 20 秒）
log "等待后端就绪..."
WAITED=0
until curl -sf http://localhost:8000/health >/dev/null 2>&1; do
  # 检查后端进程是否意外退出
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    err "后端启动失败，请检查 backend/.env 中的配置（数据库 URL、JWT Secret 等）"
  fi
  WAITED=$((WAITED + 1))
  [[ $WAITED -ge 20 ]] && { warn "后端健康检查超时，继续启动前端..."; break; }
  printf "."
  sleep 1
done
echo ""
ok "后端已就绪  →  API 文档：http://localhost:8000/docs"

# ════════════════════════════════════════════════════════════════════════
step "【6/6】启动前端"
# ════════════════════════════════════════════════════════════════════════

# 安装前端依赖（首次或依赖更新后）
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  log "安装前端依赖（首次运行）..."
  pnpm install
fi

echo ""
echo -e "${GREEN}${BOLD}┌──────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}${BOLD}│            元AI 全栈开发环境已就绪            │${NC}"
echo -e "${GREEN}${BOLD}├──────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}${BOLD}│  Web 前端 ：http://localhost:3000             │${NC}"
echo -e "${GREEN}${BOLD}│  后端 API ：http://localhost:8000             │${NC}"
echo -e "${GREEN}${BOLD}│  API 文档 ：http://localhost:8000/docs        │${NC}"
echo -e "${GREEN}${BOLD}│  MinIO   ：http://localhost:9001              │${NC}"
echo -e "${GREEN}${BOLD}├──────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}${BOLD}│  按 Ctrl+C 退出（后端会自动停止）             │${NC}"
echo -e "${GREEN}${BOLD}└──────────────────────────────────────────────┘${NC}"
echo ""

# 前台运行前端，退出时 trap cleanup EXIT 自动停止后端
pnpm --filter @yuanai/web dev
