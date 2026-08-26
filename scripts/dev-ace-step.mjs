/**
 * 启动本机 ACE-Step REST 服务。
 *
 * ACE-Step 是独立的模型服务，不作为 YuanAI workspace 依赖安装，也不在 FastAPI 进程中加载。
 * 使用 ACE_STEP_DIR 指向本机 ACE-Step checkout，避免把用户机器路径写入项目配置。
 */

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const aceStepDir = process.env.ACE_STEP_DIR
const host = process.env.ACE_STEP_HOST ?? '127.0.0.1'
const port = process.env.ACE_STEP_PORT ?? '8001'

if (!aceStepDir) {
  console.error('缺少 ACE_STEP_DIR，请将它设置为本机 ACE-Step-1.5 目录')
  process.exitCode = 1
} else {
  try {
    await access(join(aceStepDir, 'pyproject.toml'))
  } catch {
    console.error(`ACE_STEP_DIR 不是有效的 ACE-Step checkout: ${aceStepDir}`)
    process.exitCode = 1
  }
}

if (process.exitCode !== 1) {
  const child = spawn('uv', ['run', 'acestep-api', '--host', host, '--port', port], {
    cwd: aceStepDir,
    env: process.env,
    stdio: 'inherit',
  })

  const forwardSignal = (signal) => child.kill(signal)
  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  child.on('error', (error) => {
    console.error(`无法启动 ACE-Step: ${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) return
    process.exitCode = code ?? 1
  })
}
