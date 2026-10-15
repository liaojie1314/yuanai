import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  REQUIRED_NODE_VERSION,
  REQUIRED_PNPM_VERSION,
  getPnpmVersion,
  getRuntimeProblems,
  normalizeVersion,
} from './check-runtime.mjs'

test('normalizes command version output', () => {
  assert.equal(normalizeVersion(' v22.21.1\n'), '22.21.1')
})

test('accepts the pinned Node.js and pnpm versions', () => {
  assert.deepEqual(
    getRuntimeProblems({ nodeVersion: REQUIRED_NODE_VERSION, pnpmVersion: REQUIRED_PNPM_VERSION }),
    []
  )
})

test('reports every incompatible runtime version', () => {
  assert.deepEqual(getRuntimeProblems({ nodeVersion: '22.20.0', pnpmVersion: '11.19.0' }), [
    'Node.js 需要 22.21.1',
    'pnpm 需要 10.22.0',
  ])
})

test('npm_execpath 是 shell 垫片时退回 PATH 探测', () => {
  // fnm / asdf / volta 给的 npm_execpath 是 shell 垫片而不是 JS 文件，交给 node 执行必然抛错。
  // 抛错后必须继续用 PATH 探测：否则 pnpm 版本明明正确，所有带 check:runtime 的入口全被拦死。
  const shim = join(mkdtempSync(join(tmpdir(), 'pnpm-shim-')), 'pnpm')
  writeFileSync(shim, '#!/bin/sh\necho 0.0.0\n', { mode: 0o755 })
  const original = process.env.npm_execpath
  process.env.npm_execpath = shim
  try {
    assert.match(normalizeVersion(getPnpmVersion() ?? ''), /^\d+\.\d+\.\d+/)
  } finally {
    if (original === undefined) delete process.env.npm_execpath
    else process.env.npm_execpath = original
  }
})
