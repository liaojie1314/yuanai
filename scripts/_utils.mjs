/**
 * 跨平台脚本公共工具（仅供 scripts/ 内部使用）
 * 兼容：macOS / Linux / Windows (cmd / PowerShell / Windows Terminal)
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
import { platform } from 'node:os'

export const WIN = platform() === 'win32'

// ── 颜色（遵循 NO_COLOR 标准，CI 环境自动关闭）────────────────────────
const COLOR = process.stdout.isTTY !== false && !process.env.NO_COLOR
const c = COLOR
  ? { R: '\x1b[0m', B: '\x1b[1m', r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m' }
  : { R: '', B: '', r: '', g: '', y: '', b: '' }

export const log  = (...s) => console.log(`${c.b}▸${c.R}`, ...s)
export const ok   = (...s) => console.log(`${c.g}✓${c.R}`, ...s)
export const warn = (...s) => console.warn(`${c.y}⚠${c.R} `, ...s)
export const step = (s)    => console.log(`\n${c.B}${s}${c.R}`)
export const dot  = ()     => process.stdout.write('.')
export const nl   = ()     => process.stdout.write('\n')

export function err(s) {
  console.error(`\n${c.r}✗${c.R}  ${s}`)
  process.exit(1)
}

export function banner(lines) {
  console.log()
  console.log(`  ${c.g}${c.B}${'─'.repeat(50)}${c.R}`)
  for (const l of lines) console.log(`  ${c.g}${c.B}  ${l}${c.R}`)
  console.log(`  ${c.g}${c.B}${'─'.repeat(50)}${c.R}`)
  console.log()
}

// ── 进程执行 ──────────────────────────────────────────────────────────

/**
 * 同步运行命令（继承 stdio），失败则退出脚本。
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, silent?: boolean, ignoreError?: boolean }} opts
 */
export function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    shell: WIN,
    cwd: opts.cwd,
  })
  if (result.error) {
    if (opts.ignoreError) return false
    err(`无法执行 "${cmd}": ${result.error.message}`)
  }
  if (result.status !== 0 && !opts.ignoreError) {
    err(`命令失败 (exit ${result.status ?? '?'}): ${[cmd, ...args].join(' ')}`)
  }
  return result.status === 0
}

/** 检查命令是否可用 */
export function hasCmd(cmd) {
  const probe = WIN ? 'where' : 'which'
  return spawnSync(probe, [cmd], { shell: WIN, stdio: 'pipe' }).status === 0
}

/** 获取命令输出（silent）*/
export function capture(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { shell: WIN, stdio: 'pipe', cwd: opts.cwd })
  return r.stdout?.toString().trim() ?? ''
}

/**
 * 后台启动进程，返回 ChildProcess。
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} opts
 */
export function bg(cmd, args = [], opts = {}) {
  return spawn(cmd, args, {
    stdio: 'inherit',
    shell: WIN,
    cwd: opts.cwd,
  })
}

/** 跨平台强制终止进程及其子进程 */
export function killProc(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return
  try {
    if (WIN) {
      // taskkill /T 同时终止子进程树
      spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
        shell: true, stdio: 'pipe',
      })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {}
}

// ── 等待工具 ──────────────────────────────────────────────────────────

/** 等待 TCP 端口可连接（每秒重试，超时则抛错）*/
export function waitPort(port, host = '127.0.0.1', timeoutSec = 60) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutSec * 1000
    const attempt = () => {
      const sock = createConnection({ port, host })
      sock.once('connect', () => { sock.destroy(); nl(); resolve() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() >= deadline) {
          nl(); reject(new Error(`等待 ${host}:${port} 超时（${timeoutSec}s）`))
        } else {
          dot(); setTimeout(attempt, 1000)
        }
      })
    }
    attempt()
  })
}

/** 等待 HTTP 接口返回 2xx（每秒重试）*/
export async function waitHttp(url, timeoutSec = 30) {
  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok) { nl(); return }
    } catch {}
    dot()
    await sleep(1000)
  }
  nl()
  throw new Error(`等待 ${url} 超时（${timeoutSec}s）`)
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 交互 ──────────────────────────────────────────────────────────────

/** 等待用户按回车 */
export function prompt(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, ans => { rl.close(); resolve(ans) })
  })
}

// ── .env 文件工具 ─────────────────────────────────────────────────────

/**
 * 读取 .env 文件，返回 { key: value } 对象（跳过注释行）。
 */
export function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
  )
}

/**
 * 就地修改 .env 文件中的若干键（保留注释和其他行）。
 * patches 为 { KEY: 'value' }，value 为 null 则删除该行。
 * 文件不存在时自动创建。
 */
export function patchEnvFile(filePath, patches) {
  const original = existsSync(filePath) ? readFileSync(filePath, 'utf8').split(/\r?\n/) : []
  const written = new Set()
  const result = []

  for (const line of original) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
    if (m && Object.hasOwn(patches, m[1])) {
      written.add(m[1])
      if (patches[m[1]] !== null) result.push(`${m[1]}=${patches[m[1]]}`)
      // null → 删除该行，不推入 result
    } else {
      result.push(line)
    }
  }

  // 追加 patches 中原文件没有的 key
  for (const [k, v] of Object.entries(patches)) {
    if (!written.has(k) && v !== null) result.push(`${k}=${v}`)
  }

  // 去掉末尾空行，保留一个换行
  while (result.length && result.at(-1) === '') result.pop()
  writeFileSync(filePath, result.join('\n') + '\n')
}

export { existsSync, copyFileSync }
