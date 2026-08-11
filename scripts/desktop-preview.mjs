#!/usr/bin/env node
/**
 * 启动桌面端生产预览，并隔离宿主工具注入的 renderer 开发地址。
 * Electron Vite 的 preview 直接加载已构建资源，不应继承外部开发服务器地址。
 */
import { spawn } from 'node:child_process'

const command = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const environment = { ...process.env }
delete environment.ELECTRON_RENDERER_URL

const child = spawn(command, ['preview', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error('无法启动桌面端预览', error)
  process.exitCode = 1
})

child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
