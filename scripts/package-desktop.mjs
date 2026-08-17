#!/usr/bin/env node
/**
 * 根据当前操作系统选择桌面安装包目标，并转交给根 package.json 中的既有脚本。
 * 这里不直接调用 electron-builder，保证开发者和 CI 使用同一套构建入口。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { assertProjectRuntime } from './check-runtime.mjs'

const TARGETS = {
  linux: { id: 'linux', label: 'Linux', script: 'package:desktop:linux' },
  darwin: { id: 'mac', label: 'macOS', script: 'package:desktop:mac' },
  win32: { id: 'win', label: 'Windows', script: 'package:desktop:win' },
}

/**
 * 返回当前操作系统可以在本机执行的打包目标。
 * @param {string} platformName Node.js 的平台标识
 * @returns {Array<{id: string, label: string, script: string}>} 可用目标
 */
export function getAvailableTargets(platformName = process.platform) {
  const target = TARGETS[platformName]
  return target === undefined ? [] : [target]
}

/**
 * 将用户输入解析为目标索引，拒绝空输入和越界选择。
 * @param {string} answer 用户输入
 * @param {number} targetCount 目标数量
 * @returns {number} 从零开始的目标索引
 */
export function parseTargetSelection(answer, targetCount) {
  const index = Number.parseInt(answer.trim(), 10)
  if (!Number.isInteger(index) || index < 1 || index > targetCount) {
    throw new Error(`请选择 1-${targetCount} 之间的打包目标。`)
  }
  return index - 1
}

/**
 * 生成交互式菜单文本，便于终端和测试复用。
 * @param {Array<{id: string, label: string, script: string}>} targets 可用目标
 * @returns {string} 菜单文本
 */
export function formatTargetMenu(targets) {
  return [
    '请选择要生成的桌面安装包：',
    ...targets.map((target, index) => `  ${index + 1}. ${target.label} (${target.script})`),
  ].join('\n')
}

/**
 * 运行项目已有的桌面打包脚本。
 * @param {{script: string}} target 目标脚本
 * @param {{platformName?: string, pnpmCommand?: string, spawn?: typeof spawnSync}} options 执行选项
 * @returns {number} 子进程退出码
 */
export function runPackageScript(target, options = {}) {
  const platformName = options.platformName ?? process.platform
  const pnpmCommand = options.pnpmCommand ?? (platformName === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const spawn = options.spawn ?? spawnSync
  const result = spawn(pnpmCommand, ['run', target.script], { stdio: 'inherit' })
  return result.status ?? 1
}

async function prompt(question) {
  const { createInterface } = await import('node:readline/promises')
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await readline.question(question)
  } finally {
    readline.close()
  }
}

async function main() {
  assertProjectRuntime()
  const targets = getAvailableTargets()
  if (targets.length === 0) {
    throw new Error(`当前操作系统（${process.platform}）没有可用的桌面打包目标。`)
  }
  process.stdout.write(`${formatTargetMenu(targets)}\n`)
  const answer = await prompt('输入编号并回车：')
  const target = targets[parseTargetSelection(answer, targets.length)]
  const exitCode = runPackageScript(target)
  process.exitCode = exitCode
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
