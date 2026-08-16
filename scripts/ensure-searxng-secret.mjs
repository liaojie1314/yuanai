#!/usr/bin/env node
/**
 * 为本地 SearXNG 生成并复用 Docker 服务密钥。
 * 密钥仅保存到被 Git 忽略的根目录 .env，且绝不输出到终端。
 */
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = process.env.YUANAI_SEARCH_ENV_FILE ?? join(ROOT, '.env')
const secretPattern = /^[a-f0-9]{64}$/

async function readEnvFile() {
  try {
    return await readFile(envFile, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return ''
    throw error
  }
}

const existing = await readEnvFile()
const lines = existing === '' ? [] : existing.split(/\r?\n/)
const secretLineIndexes = lines
  .map((line, index) => ({ index, match: /^SEARXNG_SECRET=(.*)$/.exec(line) }))
  .filter((entry) => entry.match !== null)

if (secretLineIndexes.length > 1) {
  throw new Error('根目录 .env 中存在多个 SEARXNG_SECRET，拒绝猜测应使用哪一个。')
}

if (secretLineIndexes.length === 1) {
  const value = secretLineIndexes[0].match?.[1] ?? ''
  if (!secretPattern.test(value)) {
    throw new Error('现有 SEARXNG_SECRET 格式无效，拒绝覆盖。')
  }
  process.stdout.write('SearXNG 本地服务密钥已就绪。\n')
} else {
  lines.push(`SEARXNG_SECRET=${randomBytes(32).toString('hex')}`)
  await writeFile(envFile, `${lines.filter(Boolean).join('\n')}\n`, { mode: 0o600 })
  process.stdout.write('已为本地 SearXNG 生成服务密钥。\n')
}
