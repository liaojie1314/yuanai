import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'

import { planClean } from './clean.mjs'

/** 搭建一个最小仓库骨架，覆盖各类产物与必须保留的源码。 */
async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), 'yuanai-clean-'))
  const dirs = [
    '.turbo',
    '.mypy_cache',
    'node_modules/.cache',
    'node_modules/react',
    'apps/web/.next',
    'apps/web/src',
    'apps/web/node_modules',
    'apps/desktop/dist',
    'apps/mobile/android',
    'packages/ui/dist',
    'packages/ui/src',
    'backend/.venv/lib',
    'backend/.ruff_cache',
    'backend/uploads-test',
    'backend/app/services/__pycache__',
    'backend/.venv/lib/__pycache__',
  ]
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, 'apps/web/tsconfig.tsbuildinfo'), '{}')
  await writeFile(join(root, 'apps/web/src/page.tsx'), 'export default null')
  await writeFile(join(root, 'packages/ui/src/index.ts'), 'export {}')
  await writeFile(join(root, '.env'), 'SECRET=1')
  return root
}

test('routine clean targets build output and tool caches only', async () => {
  const root = await buildFixture()
  const targets = (await planClean({ root })).map((entry) => relative(root, entry))

  for (const expected of [
    '.turbo',
    '.mypy_cache',
    'node_modules/.cache',
    'apps/web/.next',
    'apps/desktop/dist',
    'packages/ui/dist',
    'backend/.ruff_cache',
    'backend/uploads-test',
    'backend/app/services/__pycache__',
    'apps/web/tsconfig.tsbuildinfo',
  ]) {
    assert.ok(targets.includes(expected), `应清理 ${expected}`)
  }

  // 源码、依赖、环境变量与重建代价高的目录都不能被常规清理碰到
  for (const kept of [
    'apps/web/src',
    'packages/ui/src',
    'apps/web/src/page.tsx',
    '.env',
    'node_modules',
    'apps/web/node_modules',
    'backend/.venv',
    'apps/mobile/android',
  ]) {
    assert.ok(!targets.includes(kept), `不应清理 ${kept}`)
  }

  // .venv 内部的 __pycache__ 不遍历，避免误删虚拟环境内容
  assert.ok(!targets.some((entry) => entry.startsWith('backend/.venv')))
})

test('deep clean additionally removes dependencies and prebuild output', async () => {
  const root = await buildFixture()
  const targets = (await planClean({ root, deep: true })).map((entry) => relative(root, entry))

  for (const expected of [
    'node_modules',
    'apps/web/node_modules',
    'backend/.venv',
    'apps/mobile/android',
  ]) {
    assert.ok(targets.includes(expected), `深度清理应包含 ${expected}`)
  }
  assert.ok(!targets.includes('apps/web/src'))
})

test('plan never escapes the repository root', async () => {
  const root = await buildFixture()
  for (const entry of await planClean({ root, deep: true })) {
    assert.ok(!relative(root, entry).startsWith('..'), `越界路径：${entry}`)
  }
})
