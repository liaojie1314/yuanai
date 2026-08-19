#!/usr/bin/env node
/**
 * 将本地构建并签名的 Android release APK 上传到已有 GitHub Release。
 * 用法：pnpm release:upload:android -- v1.0.0 [APK 路径]
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_ANDROID_ARTIFACT = join(
  ROOT,
  'apps',
  'mobile',
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk'
)

/** 返回默认本地 Android release APK 路径。 */
export function getAndroidReleaseArtifactPath() {
  return DEFAULT_ANDROID_ARTIFACT
}

/** 根据目标 Git tag 返回发布资产名称。 */
export function getAndroidReleaseAssetName(tag) {
  return `YuanAI-${tag}-android.apk`
}

/** 构造替换已有 Android 资产的 GitHub CLI 参数。 */
export function getReleaseUploadArgs(tag, artifactPath) {
  return ['release', 'upload', tag, artifactPath, '--clobber']
}

/** 兼容 pnpm script 传递的分隔符参数。 */
export function parseCliArgs(args) {
  return args[0] === '--' ? args.slice(1) : args
}

function printUsage() {
  console.error('用法：pnpm release:upload:android -- v<version> [APK 路径]')
}

/** 上传一个已存在的本地 Android APK 到 GitHub Release。 */
export function uploadAndroidRelease(tag, sourcePath, options = {}) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    console.error(`无效的 Git tag：${tag}`)
    return 1
  }
  if (!existsSync(sourcePath)) {
    console.error(`未找到 Android APK：${sourcePath}。请先运行 pnpm package:mobile:android。`)
    return 1
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'yuanai-release-upload-'))
  const assetPath = join(temporaryDirectory, getAndroidReleaseAssetName(tag))
  const runner = options.spawn ?? spawnSync
  copyFileSync(sourcePath, assetPath)
  try {
    const result = runner('gh', getReleaseUploadArgs(tag, assetPath), {
      cwd: ROOT,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })
    if (result.error) {
      console.error(`无法启动 GitHub CLI：${result.error.message}`)
      return 1
    }
    return result.status ?? 1
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, suppliedArtifactPath] = parseCliArgs(process.argv.slice(2))
  if (!tag) {
    printUsage()
    process.exitCode = 1
  } else {
    process.exitCode = uploadAndroidRelease(
      tag,
      suppliedArtifactPath ?? getAndroidReleaseArtifactPath()
    )
  }
}
