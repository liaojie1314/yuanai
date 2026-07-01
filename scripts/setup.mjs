#!/usr/bin/env node
/**
 * 元AI — 首次项目初始化脚本
 * 用法：pnpm setup
 * 兼容：macOS / Linux / Windows
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WIN, log, ok, warn, err, step, banner, prompt,
  run, hasCmd, capture, existsSync, copyFileSync, patchEnvFile,
} from './_utils.mjs'

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(ROOT, 'backend')
const WEB_ENV = join(ROOT, 'apps', 'web', '.env.local')

// ════════════════════════════════════════════════════════════════════════
step('【1/4】检查必要工具')
// ════════════════════════════════════════════════════════════════════════

const tools = [
  { cmd: 'node',   label: 'Node.js',  hint: 'https://nodejs.org' },
  { cmd: 'pnpm',   label: 'pnpm',     hint: 'npm install -g pnpm' },
  { cmd: 'uv',     label: 'uv',       hint: 'curl -LsSf https://astral.sh/uv/install.sh | sh' },
  { cmd: 'docker', label: 'Docker',   hint: 'https://docs.docker.com/get-docker/' },
  { cmd: 'git',    label: 'Git',      hint: 'https://git-scm.com' },
]

let allOk = true
for (const t of tools) {
  if (hasCmd(t.cmd)) {
    const ver = capture(t.cmd, ['--version']).split('\n')[0]
    ok(`${t.label.padEnd(10)} ${ver}`)
  } else {
    warn(`${t.label.padEnd(10)} 未找到 → 请先安装：${t.hint}`)
    allOk = false
  }
}
if (!allOk) err('请先安装以上缺失工具，然后重新运行 pnpm setup')

// ════════════════════════════════════════════════════════════════════════
step('【2/4】安装依赖')
// ════════════════════════════════════════════════════════════════════════

log('安装前端依赖（pnpm install）...')
run('pnpm', ['install'], { cwd: ROOT })
ok('前端依赖安装完成')

log('安装后端依赖（uv sync）...')
run('uv', ['sync'], { cwd: BACKEND })
ok('后端依赖安装完成')

// ════════════════════════════════════════════════════════════════════════
step('【3/4】初始化环境变量')
// ════════════════════════════════════════════════════════════════════════

const backendEnv = join(BACKEND, '.env')
if (!existsSync(backendEnv)) {
  copyFileSync(join(BACKEND, '.env.example'), backendEnv)
  ok('已创建 backend/.env（从 .env.example 复制）')
} else {
  ok('backend/.env 已存在，跳过')
}

// 前端默认使用 mock 模式（无需后端即可运行）
patchEnvFile(WEB_ENV, {
  NEXT_PUBLIC_MOCK: 'true',
  NEXT_PUBLIC_API_URL: null,  // 移除，避免与 MOCK 冲突
})
ok('前端默认配置为 Mock 模式（apps/web/.env.local）')

// ════════════════════════════════════════════════════════════════════════
step('【4/4】初始化数据库（可选）')
// ════════════════════════════════════════════════════════════════════════

const initDb = await prompt('  是否现在启动 Docker 并初始化数据库？[y/N] ')

if (initDb.trim().toLowerCase() === 'y') {
  log('启动 Docker 基础设施...')
  run('docker', ['compose', '-f', join(ROOT, 'docker-compose.yml'), 'up', '-d'])
  ok('Docker 已启动')

  log('执行数据库迁移...')
  run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: BACKEND })
  ok('数据库迁移完成')
} else {
  warn('跳过数据库初始化，需要时运行：docker compose up -d && cd backend && uv run alembic upgrade head')
}

// ════════════════════════════════════════════════════════════════════════
banner([
  '元AI 初始化完成！',
  '',
  '下一步：',
  '',
  '  快速体验（Mock 模式，无需后端）:',
  '    pnpm dev:mock',
  '',
  '  全栈开发（需先填写 backend/.env 中的 API Key）:',
  '    pnpm dev:real',
  '',
  '  AI API Key 配置说明: docs/ai-providers.md',
])
