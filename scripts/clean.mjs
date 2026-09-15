#!/usr/bin/env node
/**
 * 清理构建产物与工具缓存。
 *
 * 默认只删除可廉价重建的产物（Next/Electron 构建、Turbo 与 Python 工具缓存、测试报告）。
 * 加 --deep 时额外删除重建代价高的目录（node_modules、backend/.venv、Expo prebuild 的
 * android/ios），这些需要重新 install 或 prebuild 才能恢复。
 *
 * 用法：node scripts/clean.mjs [--deep] [--dry-run]
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 每个 workspace 包内都可能出现的产物目录。 */
const WORKSPACE_ARTIFACTS = [
  '.next',
  'dist',
  'out',
  'release',
  '.turbo',
  '.expo',
  'coverage',
  'test-results',
  'playwright-report',
]

/** 仓库根目录下的产物与缓存。 */
const ROOT_ARTIFACTS = [
  '.turbo',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.expo',
  'coverage',
  'test-results',
  'playwright-report',
  'node_modules/.cache',
]

/** 后端 Python 工具缓存与测试落盘目录。 */
const BACKEND_ARTIFACTS = [
  'backend/.mypy_cache',
  'backend/.pytest_cache',
  'backend/.ruff_cache',
  'backend/htmlcov',
  'backend/uploads-test',
]

/** 仅 --deep 删除：重建需要 install / prebuild。 */
const DEEP_ARTIFACTS = ['backend/.venv', 'apps/mobile/android', 'apps/mobile/ios']

/** 遍历时始终跳过的目录，避免把源码或 git 元数据卷进来。 */
const SKIP_WALK = new Set(['node_modules', '.venv', '.git', '.next', 'dist', '.turbo'])

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 递归收集 __pycache__ 目录与 *.tsbuildinfo 文件。 */
async function walkGenerated(root, current, found) {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(current, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        found.push(full)
        continue
      }
      if (SKIP_WALK.has(entry.name)) continue
      await walkGenerated(root, full, found)
    } else if (entry.name.endsWith('.tsbuildinfo')) {
      found.push(full)
    }
  }
  return found
}

/**
 * 计算要删除的路径列表，不做任何删除，便于测试。
 *
 * @param {{ root?: string, deep?: boolean }} options
 * @returns {Promise<string[]>} 绝对路径列表，全部位于 root 之内
 */
export async function planClean({ root = ROOT, deep = false } = {}) {
  const candidates = [
    ...ROOT_ARTIFACTS.map((entry) => join(root, entry)),
    ...BACKEND_ARTIFACTS.map((entry) => join(root, entry)),
  ]

  for (const group of ['apps', 'packages']) {
    for (const name of await listDirectories(join(root, group))) {
      for (const artifact of WORKSPACE_ARTIFACTS) {
        candidates.push(join(root, group, name, artifact))
      }
    }
  }

  candidates.push(...(await walkGenerated(root, root, [])))

  if (deep) {
    candidates.push(...DEEP_ARTIFACTS.map((entry) => join(root, entry)))
    candidates.push(join(root, 'node_modules'))
    for (const group of ['apps', 'packages']) {
      for (const name of await listDirectories(join(root, group))) {
        candidates.push(join(root, group, name, 'node_modules'))
      }
    }
  }

  const resolvedRoot = resolve(root)
  const unique = [...new Set(candidates.map((entry) => resolve(entry)))]
  const inside = unique.filter((entry) => {
    const rel = relative(resolvedRoot, entry)
    return rel !== '' && !rel.startsWith('..')
  })

  const present = []
  for (const entry of inside) {
    if (await exists(entry)) present.push(entry)
  }
  return present.sort()
}

async function sizeOf(path) {
  let total = 0
  const info = await stat(path).catch(() => null)
  if (info === null) return 0
  if (info.isFile()) return info.size
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    total += await sizeOf(join(path, entry.name))
  }
  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deep = process.argv.includes('--deep')
  const dryRun = process.argv.includes('--dry-run')
  const targets = await planClean({ deep })

  if (targets.length === 0) {
    process.stdout.write('没有需要清理的产物。\n')
  } else {
    let reclaimed = 0
    for (const target of targets) {
      reclaimed += await sizeOf(target)
      if (!dryRun) await rm(target, { recursive: true, force: true })
    }
    const verb = dryRun ? '将清理' : '已清理'
    process.stdout.write(`${verb} ${targets.length} 项，释放 ${formatBytes(reclaimed)}。\n`)
    for (const target of targets) {
      process.stdout.write(`  ${relative(ROOT, target)}\n`)
    }
  }

  if (deep && !dryRun) {
    process.stdout.write('\n深度清理已移除依赖：重新运行 pnpm install 后才能继续开发。\n')
  }
}
