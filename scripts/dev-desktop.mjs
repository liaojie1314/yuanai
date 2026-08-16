#!/usr/bin/env node
/**
 * 启动桌面端开发环境，并隔离宿主工具注入的 renderer 地址。
 * Electron Vite 会自行启动 renderer；继承外部地址会让 Electron 加载到无关页面。
 */
import { spawn } from 'node:child_process'

// npm scripts already expose the packageManager-pinned pnpm on PATH. Reusing it
// avoids depending on a globally installed Corepack binary.
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const environment = { ...process.env }
delete environment.ELECTRON_RENDERER_URL
if (process.platform === 'linux' && environment.CHOKIDAR_USEPOLLING === undefined) {
  environment.CHOKIDAR_USEPOLLING = 'true'
}

const child = spawn(command, ['--filter', '@yuanai/desktop', 'dev', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error('无法启动桌面端开发环境', error)
  process.exitCode = 1
})

child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
