#!/usr/bin/env node
/**
 * 元AI — 移动端 Mock 模式一键启动（对齐 pnpm dev:mock）
 * 用法：pnpm dev:mobile:mock
 * 平台：macOS / Linux / Windows
 *
 * 启动顺序：先决条件 → env 配置（EXPO_PUBLIC_MOCK=1）→
 *          Android 模拟器 → adb reverse tcp:8081 → Metro（前台）
 *
 * 与 pnpm dev:mobile 的差异：
 *   - 不启动 Docker / PostgreSQL / Redis / MinIO
 *   - 不跑 alembic 迁移、不启动后端
 *   - 写入 EXPO_PUBLIC_MOCK=1，让 app 后续接入 msw/native 时按开关激活
 *   - adb reverse 只做 8081（Metro reload），不做 8000（无后端）
 *
 * ⚠️ 当前 mobile 端 MSW 拦截尚未接入。脚本先落地"启动通道"，
 *    跑起来后 app 会向 EXPO_PUBLIC_API_URL 发真请求，无后端时会全部 fail。
 *    用途：验证冷启动 / Splash / router / 主题；真正 mock 数据待 Step 7 后
 *    单独接入 msw/native handlers。
 *
 * 退出（Ctrl+C）时 Metro 会被 kill；模拟器不动，方便下次复用。
 */
import { existsSync as _existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WIN,
  log,
  ok,
  warn,
  err,
  step,
  banner,
  run,
  hasCmd,
  bg,
  killProc,
  capture,
  freePort,
  sleep,
  patchEnvFile,
} from './_utils.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MOBILE = join(ROOT, 'apps', 'mobile')
const MOBILE_ENV = join(MOBILE, '.env')

const procs = []
function cleanup() {
  for (const p of procs) killProc(p)
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
if (WIN) process.on('SIGHUP', () => process.exit(0))

// ── Android SDK 定位（与 dev-mobile.mjs 同款）────────────────────────
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
step('【1/5】检查先决条件（Mock 模式：只需 pnpm + Android SDK）')
// ════════════════════════════════════════════════════════════════════════

hasCmd('pnpm') || err('未找到 pnpm：npm install -g pnpm')

const ANDROID_HOME = resolveAndroidSdk()
if (!ANDROID_HOME) {
  err(
    '未找到 Android SDK。设置 ANDROID_HOME 环境变量，或安装 Android Studio。\n' +
      '   常见路径：\n' +
      '     Linux/macOS: ~/Android/Sdk 或 ~/env/Android/Sdk\n' +
      '     macOS 默认:  ~/Library/Android/sdk\n' +
      '     Windows:     %LOCALAPPDATA%\\Android\\Sdk'
  )
}
const ADB = join(ANDROID_HOME, 'platform-tools', WIN ? 'adb.exe' : 'adb')
const EMULATOR = join(ANDROID_HOME, 'emulator', WIN ? 'emulator.exe' : 'emulator')
_existsSync(EMULATOR) ||
  err(`emulator 命令未找到（${EMULATOR}）\n   请在 Android Studio 里安装 Emulator SDK 组件。`)

process.env.ANDROID_HOME = ANDROID_HOME
process.env.ANDROID_SDK_ROOT = ANDROID_HOME
process.env.PATH = `${join(ANDROID_HOME, 'platform-tools')}${WIN ? ';' : ':'}${join(ANDROID_HOME, 'emulator')}${WIN ? ';' : ':'}${process.env.PATH}`

ok(`Android SDK: ${ANDROID_HOME}`)

// ════════════════════════════════════════════════════════════════════════
step('【2/5】切换 apps/mobile/.env 到 Mock 模式')
// ════════════════════════════════════════════════════════════════════════

// EXPO_PUBLIC_MOCK=1 是 app 启动时判断"是否激活 MSW"的开关（当前 mobile 端未接入 msw/native，
// 见文件头 ⚠️）。同时 process.env.EXPO_PUBLIC_MOCK 也写一份，避免 Expo 优先读进程 env 时漏读。
patchEnvFile(MOBILE_ENV, {
  EXPO_PUBLIC_MOCK: '1',
})
process.env.EXPO_PUBLIC_MOCK = '1'
ok('apps/mobile/.env → EXPO_PUBLIC_MOCK=1（对应 pnpm dev:mobile 会清除该变量）')

// ════════════════════════════════════════════════════════════════════════
step('【3/5】启动 Android 模拟器')
// ════════════════════════════════════════════════════════════════════════

run(ADB, ['start-server'], { silent: true, ignoreError: true })
let deviceList = capture(ADB, ['devices'])
  .split(/\r?\n/)
  .slice(1)
  .filter((l) => /\bdevice\b/.test(l))

if (deviceList.length === 0) {
  const avds = capture(EMULATOR, ['-list-avds']).split(/\r?\n/).filter(Boolean)
  if (avds.length === 0) {
    err('未检测到 Android AVD。请先在 Android Studio → Device Manager 创建一个模拟器。')
  }
  log(`可用 AVD：${avds.join(', ')}`)
  const target = avds[0]
  log(`启动 ${target}（后台，headless=false）...`)
  // detach：模拟器跨会话复用，不随本脚本退出；不 detach 会阻塞脚本退出流程
  const emu = bg(EMULATOR, ['-avd', target, '-no-boot-anim', '-no-snapshot-save'], { detach: true })
  // 等 boot 完成（最长 3 分钟）
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await sleep(3000)
    const boot = capture(ADB, ['shell', 'getprop', 'sys.boot_completed']).trim()
    if (boot === '1') break
  }
  const boot = capture(ADB, ['shell', 'getprop', 'sys.boot_completed']).trim()
  if (boot !== '1') err('模拟器启动超时（180s）。可尝试手动 `emulator -avd <name>`。')
  deviceList = capture(ADB, ['devices'])
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => /\bdevice\b/.test(l))
}

ok(`Android 设备：${deviceList.map((l) => l.split(/\s+/)[0]).join(', ')}`)

// ════════════════════════════════════════════════════════════════════════
step('【4/5】adb reverse 端口（Metro reload / HMR）')
// ════════════════════════════════════════════════════════════════════════

// Mock 模式不需要 tcp:8000（无后端）；只反转 tcp:8081 给 Metro 用。
run(ADB, ['reverse', 'tcp:8081', 'tcp:8081'], { silent: true, ignoreError: true })
ok('adb reverse tcp:8081 tcp:8081')

const installed = capture(ADB, ['shell', 'pm', 'list', 'packages', 'com.yuanai.app']).includes(
  'com.yuanai.app'
)
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
step('【5/5】启动 Metro Bundler（Mock 模式）')
// ════════════════════════════════════════════════════════════════════════

warn('mobile 端 MSW 尚未接入 — 本脚本只负责启动通道。')
warn('  API 请求会走 EXPO_PUBLIC_API_URL（默认 localhost:8000），无后端时会失败。')
warn('  用途：验证冷启动 / Splash / router / 主题；真数据待后续接 msw/native。')

banner([
  '元AI 移动端开发环境（Mock 模式）已就绪',
  '',
  '  Metro                →  http://localhost:8081  (即将启动)',
  '  EXPO_PUBLIC_MOCK     →  1',
  '  EXPO_PUBLIC_API_URL  →  见 apps/mobile/.env',
  '',
  '  切回真实后端：pnpm dev:mobile （会清除 EXPO_PUBLIC_MOCK）',
  '  按 Ctrl+C 退出（Metro 一起停）',
])

// 清掉上次会话残留的 Metro —— 8081 被占时 expo 会交互式问"换端口？"，
// 非交互环境（CI / 后台任务）下它直接跳过 dev server，脚本假死。
await freePort(8081, '残留 Metro')

// 前台运行 Metro，阻塞到 Ctrl+C。透传 EXPO_PUBLIC_MOCK 让 Expo 环境变量注入生效。
const metro = bg(
  'pnpm',
  ['--filter', '@yuanai/mobile', 'exec', 'expo', 'start', '--dev-client', '--port', '8081'],
  { cwd: ROOT }
)
procs.push(metro)

// 若 app 已装，等 Metro up 后自动 launch（用 monkey 触发默认 Launcher intent）
if (installed) {
  setTimeout(() => {
    run(
      ADB,
      ['shell', 'monkey', '-p', 'com.yuanai.app', '-c', 'android.intent.category.LAUNCHER', '1'],
      { silent: true, ignoreError: true }
    )
  }, 8000)
}

await new Promise((resolve) => metro.on('exit', resolve))
