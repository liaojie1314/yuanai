import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_NODE_VERSION,
  REQUIRED_PNPM_VERSION,
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
