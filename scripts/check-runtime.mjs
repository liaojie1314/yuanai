#!/usr/bin/env node
/**
 * 验证项目运行时版本，避免不同 Node.js 或 pnpm 版本重写锁文件后导致启动失败。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REQUIRED_NODE_VERSION = '22.21.1'
export const REQUIRED_PNPM_VERSION = '10.22.0'

/**
 * 去除命令版本输出中的可选 v 前缀与空白字符。
 * @param {string} version 原始版本文本
 * @returns {string} 可比较的语义化版本字符串
 */
export function normalizeVersion(version) {
  return version.trim().replace(/^v/, '')
}

/**
 * 返回当前版本与项目锁定版本不一致时的中文诊断信息。
 * @param {{ nodeVersion?: string, pnpmVersion?: string | null }} versions 待校验的版本
 * @returns {string[]} 所有不匹配项；空数组表示版本符合要求
 */
export function getRuntimeProblems({ nodeVersion, pnpmVersion }) {
  const problems = []
  if (normalizeVersion(nodeVersion ?? process.versions.node) !== REQUIRED_NODE_VERSION) {
    problems.push(`Node.js 需要 ${REQUIRED_NODE_VERSION}`)
  }
  if (pnpmVersion === null || normalizeVersion(pnpmVersion) !== REQUIRED_PNPM_VERSION) {
    problems.push(`pnpm 需要 ${REQUIRED_PNPM_VERSION}`)
  }
  return problems
}

/**
 * 读取 PATH 中 pnpm 的版本；pnpm 缺失时返回 null。
 * @returns {string | null} pnpm 版本或 null
 */
export function getPnpmVersion() {
  try {
    const invokingPnpm = process.env.npm_execpath
    if (invokingPnpm?.includes('pnpm')) {
      return execFileSync(process.execPath, [invokingPnpm, '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    return execFileSync(command, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

/**
 * 在版本不匹配时抛出可操作的错误，供所有开发和打包入口复用。
 * @returns {void}
 */
export function assertProjectRuntime() {
  const problems = getRuntimeProblems({ pnpmVersion: getPnpmVersion() })
  if (problems.length === 0) return

  const detail = problems.map((problem) => `  - ${problem}`).join('\n')
  throw new Error(
    `项目运行时版本不匹配：\n${detail}\n\n` +
      `推荐使用 Corepack：\n` +
      `  corepack enable\n` +
      `  corepack prepare pnpm@${REQUIRED_PNPM_VERSION} --activate\n\n` +
      `若系统不提供 Corepack，可使用 Volta：\n` +
      `  volta install node@${REQUIRED_NODE_VERSION} pnpm@${REQUIRED_PNPM_VERSION}`
  )
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] === scriptPath) {
  try {
    assertProjectRuntime()
    process.stdout.write(
      `运行时版本正确：Node.js ${REQUIRED_NODE_VERSION}，pnpm ${REQUIRED_PNPM_VERSION}。\n`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
