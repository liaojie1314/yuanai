#!/usr/bin/env node
/**
 * 同步桌面、Web、Mobile 与共享包的发布版本。
 * release-it 只修改根 package.json，其他运行时清单由这个脚本保持一致。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_FILES = [
  'apps/web/package.json',
  'apps/mobile/package.json',
  'apps/desktop/package.json',
  'packages/core/package.json',
  'packages/types/package.json',
  'packages/ui/package.json',
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function toNativeBuildNumber(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) {
    throw new Error(`无法从 ${version} 生成 Android versionCode`)
  }
  const [, major, minor, patch] = match
  return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch)
}

/**
 * 从根 package.json 读取版本并同步所有发布相关清单。
 * @param {string} rootDir 仓库根目录，测试时可传入临时目录
 * @param {{ syncNativeBuild?: boolean }} options 是否同步 Android/iOS 原生构建号
 * @returns {string} 同步后的版本号
 */
export function syncVersions(rootDir = ROOT, options = {}) {
  const rootPackagePath = resolve(rootDir, 'package.json')
  const rootPackage = readJson(rootPackagePath)
  const version = rootPackage.version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('根 package.json 缺少有效 version')
  }

  for (const relativePath of PACKAGE_FILES) {
    const path = resolve(rootDir, relativePath)
    const packageJson = readJson(path)
    packageJson.version = version
    writeJson(path, packageJson)
  }

  const appJsonPath = resolve(rootDir, 'apps/mobile/app.json')
  const appJson = readJson(appJsonPath)
  if (!appJson.expo || typeof appJson.expo !== 'object') {
    throw new Error('apps/mobile/app.json 缺少 expo 配置')
  }
  appJson.expo.version = version
  if (options.syncNativeBuild) {
    const nativeBuildNumber = toNativeBuildNumber(version)
    if (!appJson.expo.android || typeof appJson.expo.android !== 'object') {
      throw new Error('apps/mobile/app.json 缺少 android 配置')
    }
    if (!appJson.expo.ios || typeof appJson.expo.ios !== 'object') {
      throw new Error('apps/mobile/app.json 缺少 ios 配置')
    }
    appJson.expo.android.versionCode = nativeBuildNumber
    appJson.expo.ios.buildNumber = String(nativeBuildNumber)
  }
  writeJson(appJsonPath, appJson)

  return version
}

const isCli =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isCli) {
  const version = syncVersions(ROOT, {
    syncNativeBuild: process.argv.includes('--native-build'),
  })
  console.log(`已同步发布版本 ${version}`)
}
