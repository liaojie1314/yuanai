#!/usr/bin/env node
/**
 * 元AI — 移动端一键启动开发环境（对齐 pnpm dev:real）
 * 用法：pnpm dev:mobile
 * 平台：macOS / Linux / Windows；启动的模拟器沿用宿主 Android SDK
 *
 * 启动顺序：先决条件 → Android SDK 定位 → env 配置 → Docker → 后端 →
 *          启动 Android 模拟器 → adb reverse → Metro（前台）
 *
 * 退出（Ctrl+C）时后端 / Metro 都会被 kill；模拟器不动，方便下次复用。
 */
import { existsSync as _existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WIN, log, ok, warn, err, step, banner, prompt,
  run, hasCmd, bg, killProc, capture,
  waitPort, waitHttp, sleep,
  existsSync, copyFileSync, patchEnvFile,
} from './_utils.mjs'

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND   = join(ROOT, 'backend')
const MOBILE    = join(ROOT, 'apps', 'mobile')
const MOBILE_ENV = join(MOBILE, '.env')

const procs = []
function cleanup() {
  for (const p of procs) killProc(p)
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
if (WIN) process.on('SIGHUP', () => process.exit(0))

// ── Android SDK 定位 ─────────────────────────────────────────────────
function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'env', 'Android', 'Sdk'),
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'), // macOS 默认
    'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Android\\Sdk',
  ]
  for (const c of candidates) {
    if (c && _existsSync(join(c, 'platform-tools', WIN ? 'adb.exe' : 'adb'))) return c
  }
  return null
}

// ════════════════════════════════════════════════════════════════════════
step('【1/7】检查先决条件')
// ════════════════════════════════════════════════════════════════════════

hasCmd('docker') || err('未找到 docker，请先安装 Docker Desktop')
hasCmd('uv')     || err('未找到 uv：curl -LsSf https://astral.sh/uv/install.sh | sh')
hasCmd('pnpm')   || err('未找到 pnpm：npm install -g pnpm')

const ANDROID_HOME = resolveAndroidSdk()
if (!ANDROID_HOME) {
  err('未找到 Android SDK。设置 ANDROID_HOME 环境变量，或安装 Android Studio。\n' +
      '   常见路径：\n' +
      '     Linux/macOS: ~/Android/Sdk 或 ~/env/Android/Sdk\n' +
      '     macOS 默认:  ~/Library/Android/sdk\n' +
      '     Windows:     %LOCALAPPDATA%\\Android\\Sdk')
}
const ADB = join(ANDROID_HOME, 'platform-tools', WIN ? 'adb.exe' : 'adb')
const EMULATOR = join(ANDROID_HOME, 'emulator', WIN ? 'emulator.exe' : 'emulator')
_existsSync(EMULATOR) || err(`emulator 命令未找到（${EMULATOR}）\n   请在 Android Studio 里安装 Emulator SDK 组件。`)

// 环境变量透传给子进程（Metro / gradle 都需要）
process.env.ANDROID_HOME = ANDROID_HOME
process.env.ANDROID_SDK_ROOT = ANDROID_HOME
process.env.PATH = `${join(ANDROID_HOME, 'platform-tools')}${WIN ? ';' : ':'}${join(ANDROID_HOME, 'emulator')}${WIN ? ';' : ':'}${process.env.PATH}`

run('docker', ['info'], { silent: true, ignoreError: true }) ||
  err('Docker 守护进程未运行，请先启动 Docker Desktop')

ok(`Android SDK: ${ANDROID_HOME}`)

// ════════════════════════════════════════════════════════════════════════
step('【2/7】配置环境变量')
// ════════════════════════════════════════════════════════════════════════

const backendEnv = join(BACKEND, '.env')
if (!existsSync(backendEnv)) {
  copyFileSync(join(BACKEND, '.env.example'), backendEnv)
  warn('backend/.env 已从 .env.example 创建，请填写 AI Key 后再继续。')
  await prompt('  按回车继续... ')
}

// 用 localhost — 下面 adb reverse tcp:8000 会把设备端 localhost:8000
// 映射到宿主机 8000，模拟器和真机（USB 调试）都通吃。
// 只有 Wi-Fi 真机或无 adb 场景才需要手动改成局域网 IP。
patchEnvFile(MOBILE_ENV, {
  EXPO_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
})
ok('apps/mobile/.env → EXPO_PUBLIC_API_URL=http://localhost:8000/api/v1')

// ════════════════════════════════════════════════════════════════════════
step('【3/7】启动 Docker 基础设施')
// ════════════════════════════════════════════════════════════════════════

log('启动 PostgreSQL + Redis + MinIO...')
run('docker', ['compose', '-f', join(ROOT, 'docker-compose.yml'), 'up', '-d'])
log('等待 PostgreSQL 就绪（5433）...')
await waitPort(5433, '127.0.0.1', 60).catch((e) => err(`${e.message}\n   docker compose ps`))
ok('PostgreSQL 就绪')

// ════════════════════════════════════════════════════════════════════════
step('【4/7】数据库迁移 + 启动后端')
// ════════════════════════════════════════════════════════════════════════

run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: BACKEND })
ok('数据库迁移完成')

// --host 0.0.0.0 是给模拟器 10.0.2.2 走宿主机 NAT 用的
const backend = bg('uv', [
  'run', 'uvicorn', 'app.main:app',
  '--host', '0.0.0.0', '--port', '8000', '--reload',
], { cwd: BACKEND })
procs.push(backend)
backend.on('exit', (code) => {
  if (code !== null && code !== 0) err(`后端意外退出 (exit ${code})`)
})
await waitHttp('http://localhost:8000/docs', 30).catch(() =>
  warn('后端健康检查超时，但进程仍在，继续启动模拟器...'))
ok('后端就绪  →  http://localhost:8000/docs')

// ════════════════════════════════════════════════════════════════════════
step('【5/7】启动 Android 模拟器')
// ════════════════════════════════════════════════════════════════════════

// 先看有没有已经跑着的 device / emulator
run(ADB, ['start-server'], { silent: true, ignoreError: true })
let deviceList = capture(ADB, ['devices']).split(/\r?\n/).slice(1).filter((l) => /\bdevice\b/.test(l))

if (deviceList.length === 0) {
  const avds = capture(EMULATOR, ['-list-avds']).split(/\r?\n/).filter(Boolean)
  if (avds.length === 0) {
    err('未检测到 Android AVD。请先在 Android Studio → Device Manager 创建一个模拟器。')
  }
  log(`可用 AVD：${avds.join(', ')}`)
  const target = avds[0]
  log(`启动 ${target}（后台，headless=false）...`)
  const emu = bg(EMULATOR, ['-avd', target, '-no-boot-anim', '-no-snapshot-save'])
  procs.push(emu)
  // 等 boot 完成（最长 3 分钟）
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await sleep(3000)
    const boot = capture(ADB, ['shell', 'getprop', 'sys.boot_completed']).trim()
    if (boot === '1') break
  }
  const boot = capture(ADB, ['shell', 'getprop', 'sys.boot_completed']).trim()
  if (boot !== '1') err('模拟器启动超时（180s）。可尝试手动 `emulator -avd <name>`。')
  deviceList = capture(ADB, ['devices']).split(/\r?\n/).slice(1).filter((l) => /\bdevice\b/.test(l))
}

ok(`Android 设备：${deviceList.map((l) => l.split(/\s+/)[0]).join(', ')}`)

// 端口反向转发（模拟器 & 真机均适用，比走 10.0.2.2 更稳）
run(ADB, ['reverse', 'tcp:8081', 'tcp:8081'], { silent: true, ignoreError: true })
run(ADB, ['reverse', 'tcp:8000', 'tcp:8000'], { silent: true, ignoreError: true })

// 检查目标 app 是否已装
const installed = capture(ADB, ['shell', 'pm', 'list', 'packages', 'com.yuanai.app']).includes('com.yuanai.app')
if (!installed) {
  banner([
    '首次启动：需要构建并安装 dev-client APK',
    '',
    '  另开一个终端跑：',
    '    pnpm --filter @yuanai/mobile android',
    '',
    '  Gradle 构建 5-10 分钟；装好后本脚本的 Metro 会自动为它服务。',
  ])
} else {
  ok('com.yuanai.app 已安装 — Metro 就绪后 app 会自动重连')
}

// ════════════════════════════════════════════════════════════════════════
step('【6/7】启动 Metro Bundler')
// ════════════════════════════════════════════════════════════════════════

banner([
  '元AI 移动端开发环境已就绪',
  '',
  '  后端 API  →  http://localhost:8000',
  '  API 文档  →  http://localhost:8000/docs',
  '  Metro     →  http://localhost:8081  (即将启动)',
  '  MinIO     →  http://localhost:9001',
  '',
  '  按 Ctrl+C 退出（后端 + Metro 一起停）',
])

// 前台运行 Metro，阻塞到 Ctrl+C
const metro = bg('pnpm', [
  '--filter', '@yuanai/mobile', 'exec',
  'expo', 'start', '--dev-client', '--port', '8081',
], { cwd: ROOT })
procs.push(metro)

// ════════════════════════════════════════════════════════════════════════
step('【7/7】等待 Metro 退出')
// ════════════════════════════════════════════════════════════════════════
// 若 app 已装，等 Metro up 后自动 launch（用 deep link + adb 触发）
if (installed) {
  setTimeout(() => {
    run(ADB, ['shell', 'monkey', '-p', 'com.yuanai.app',
      '-c', 'android.intent.category.LAUNCHER', '1'], { silent: true, ignoreError: true })
  }, 8000)
}

await new Promise((resolve) => metro.on('exit', resolve))
