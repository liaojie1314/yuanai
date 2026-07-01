#!/usr/bin/env node
/**
 * 元AI — 一键启动全栈开发环境（真实接口模式）
 * 用法：pnpm dev:real
 * 兼容：macOS / Linux / Windows
 *
 * 启动顺序：Docker 基础设施 → PostgreSQL 就绪 → 数据库迁移 → 后端 → 前端
 * 退出（Ctrl+C）时自动停止后端进程。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WIN, log, ok, warn, err, step, banner, prompt,
  run, hasCmd, bg, killProc,
  waitPort, waitHttp,
  existsSync, copyFileSync, patchEnvFile,
} from './_utils.mjs'

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(ROOT, 'backend')
const WEB_ENV = join(ROOT, 'apps', 'web', '.env.local')

// ── 进程注册表（用于退出时清理）────────────────────────────────────────
const procs = []

function cleanup() {
  for (const p of procs) killProc(p)
}
process.on('exit', cleanup)
process.on('SIGINT',  () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
// Windows: Ctrl+C 通过 SIGINT 事件传达，Node.js 已处理
if (WIN) process.on('SIGHUP', () => process.exit(0))

// ════════════════════════════════════════════════════════════════════════
step('【1/6】检查先决条件')
// ════════════════════════════════════════════════════════════════════════

hasCmd('docker') || err('未找到 docker，请先安装 Docker Desktop → https://docs.docker.com/get-docker/')
hasCmd('uv')     || err('未找到 uv，请先安装 → curl -LsSf https://astral.sh/uv/install.sh | sh\n       Windows: winget install --id=astral-sh.uv')
hasCmd('pnpm')   || err('未找到 pnpm，请先安装 → npm install -g pnpm')

// 检查 Docker 守护进程是否在运行
run('docker', ['info'], { silent: true, ignoreError: true }) ||
  err('Docker 守护进程未运行，请先启动 Docker Desktop')

ok('先决条件检查通过')

// ════════════════════════════════════════════════════════════════════════
step('【2/6】检查环境变量配置')
// ════════════════════════════════════════════════════════════════════════

const backendEnv = join(BACKEND, '.env')

if (!existsSync(backendEnv)) {
  copyFileSync(join(BACKEND, '.env.example'), backendEnv)
  console.log()
  warn('backend/.env 不存在，已从 .env.example 自动创建。')
  console.log(`
  ${'\x1b[33m'}请填写至少一个 AI 提供商的 API Key：

    DEEPSEEK_API_KEY=sk-xxxx    ← 推荐（免费额度）
    OPENAI_API_KEY=sk-proj-xxx
    ANTHROPIC_API_KEY=sk-ant-xx

  文件路径：backend/.env
  详细说明：docs/ai-providers.md
${'\x1b[0m'}`)
  await prompt('  填写完毕后按回车继续，或按 Ctrl+C 退出... ')
}

// 强制切换为真实接口模式（移除 MOCK 标记，写入 API URL）
patchEnvFile(WEB_ENV, {
  NEXT_PUBLIC_MOCK:    null,                              // 删除，避免与真实模式冲突
  NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
})
ok('前端已配置为真实接口模式')

// ════════════════════════════════════════════════════════════════════════
step('【3/6】启动 Docker 基础设施')
// ════════════════════════════════════════════════════════════════════════

log('启动 PostgreSQL + Redis + MinIO...')
run('docker', ['compose', '-f', join(ROOT, 'docker-compose.yml'), 'up', '-d'])

// 等待 PostgreSQL 端口可连接（宿主机 5433 → 容器 5432）
log('等待 PostgreSQL 就绪（端口 5433）...')
try {
  await waitPort(5433, '127.0.0.1', 60)
  ok('PostgreSQL 就绪')
} catch (e) {
  err(`${e.message}\n   请检查：docker compose ps`)
}

// ════════════════════════════════════════════════════════════════════════
step('【4/6】数据库迁移')
// ════════════════════════════════════════════════════════════════════════

log('执行 alembic upgrade head...')
run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: BACKEND })
ok('数据库迁移完成')

// ════════════════════════════════════════════════════════════════════════
step('【5/6】启动后端')
// ════════════════════════════════════════════════════════════════════════

log('启动 FastAPI (http://localhost:8000)...')
const backend = bg(
  'uv',
  ['run', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'],
  { cwd: BACKEND }
)
procs.push(backend)

backend.on('exit', (code) => {
  if (code !== null && code !== 0) {
    err(`后端意外退出 (exit ${code})，请检查 backend/.env 配置`)
  }
})

log('等待后端就绪...')
try {
  await waitHttp('http://localhost:8000/health', 30)
  ok('后端就绪  →  API 文档：http://localhost:8000/docs')
} catch {
  // 健康检查超时：后端可能仍在初始化，给用户提示后继续
  warn('后端健康检查超时，但进程仍在运行，继续启动前端...')
}

// ════════════════════════════════════════════════════════════════════════
step('【6/6】启动前端')
// ════════════════════════════════════════════════════════════════════════

// 安装前端依赖（首次或依赖更新后）
if (!existsSync(join(ROOT, 'node_modules'))) {
  log('安装前端依赖（首次运行）...')
  run('pnpm', ['install'], { cwd: ROOT })
}

banner([
  '元AI 全栈开发环境已就绪',
  '',
  `  Web 前端  →  http://localhost:3000`,
  `  后端 API  →  http://localhost:8000`,
  `  API 文档  →  http://localhost:8000/docs`,
  `  MinIO     →  http://localhost:9001  (minioadmin / minioadmin)`,
  '',
  '  按 Ctrl+C 退出（后端进程将自动停止）',
])

// 前台运行前端，阻塞直到用户退出
const frontend = bg('pnpm', ['--filter', '@yuanai/web', 'dev'], { cwd: ROOT })
procs.push(frontend)

// 等待前端进程退出（正常退出或 Ctrl+C 触发 cleanup）
await new Promise(resolve => frontend.on('exit', resolve))
