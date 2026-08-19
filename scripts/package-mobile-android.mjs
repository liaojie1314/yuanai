#!/usr/bin/env node
/**
 * 使用已生成的 Expo Android 原生目录构建本地 release APK。
 * 该脚本只负责调用 Gradle wrapper，配置同步由 mobile 的 prebuild script 完成。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ANDROID_DIR = join(ROOT, 'apps', 'mobile', 'android')
const GRADLE = join(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const APK_PATH = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.yuanai-secrets', 'yuanai-android-release.json')

/** 返回本地 Android release APK 的固定输出路径。 */
export function getAndroidArtifactPath() {
  return APK_PATH
}

/**
 * 将本地 keystore 凭据转换为 Android Gradle Plugin 的注入签名参数。
 * @param {{ keystorePath: string, keyAlias: string, storePassword: string, keyPassword: string }} credentials 本地私钥凭据
 * @returns {string[]} 不含日志输出的 Gradle 签名参数
 */
export function getAndroidSigningArgs(credentials) {
  return [
    `-Pandroid.injected.signing.store.file=${credentials.keystorePath}`,
    `-Pandroid.injected.signing.store.password=${credentials.storePassword}`,
    `-Pandroid.injected.signing.key.alias=${credentials.keyAlias}`,
    `-Pandroid.injected.signing.key.password=${credentials.keyPassword}`,
    '-Pandroid.injected.signing.store.type=PKCS12',
  ]
}

/** 为 Gradle release 构建提供稳定的 Expo 环境模式。 */
export function getAndroidBuildEnvironment(environment) {
  return { ...environment, NODE_ENV: environment.NODE_ENV ?? 'production' }
}

function readLocalSigningCredentials() {
  const credentialsPath = process.env.YUANAI_ANDROID_KEYSTORE_CONFIG ?? DEFAULT_CREDENTIALS_PATH
  if (!existsSync(credentialsPath)) {
    console.error(
      `未找到 Android release 签名材料：${credentialsPath}。请先运行 pnpm signing:android。`
    )
    return undefined
  }

  try {
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))
    if (
      typeof credentials.keystorePath !== 'string' ||
      typeof credentials.keyAlias !== 'string' ||
      typeof credentials.storePassword !== 'string' ||
      typeof credentials.keyPassword !== 'string' ||
      !existsSync(credentials.keystorePath)
    ) {
      console.error('Android release 签名材料无效，请重新运行 pnpm signing:android。')
      return undefined
    }
    return credentials
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.error(`无法读取 Android release 签名材料：${message}`)
    return undefined
  }
}

/** 使用 Gradle wrapper 构建本地 Android release APK，返回进程退出码。 */
export function buildAndroidRelease() {
  if (!existsSync(GRADLE)) {
    console.error('未找到 apps/mobile/android/gradlew，请先运行 mobile 的 prebuild script。')
    return 1
  }

  const credentials = readLocalSigningCredentials()
  if (!credentials) {
    return 1
  }

  const result = spawnSync(GRADLE, ['assembleRelease', ...getAndroidSigningArgs(credentials)], {
    cwd: ANDROID_DIR,
    env: getAndroidBuildEnvironment(process.env),
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`Android Gradle 构建启动失败：${result.error.message}`)
    return 1
  }
  if (result.status !== 0) {
    return result.status ?? 1
  }
  if (!existsSync(APK_PATH)) {
    console.error(`Gradle 已结束，但未找到 APK：${APK_PATH}`)
    return 1
  }

  console.log(`Android release APK：${APK_PATH}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = buildAndroidRelease()
}
