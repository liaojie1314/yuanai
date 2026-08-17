#!/usr/bin/env node
/**
 * 在当前用户目录生成 Android 发布签名材料，避免把私钥放进仓库。
 * 用法：pnpm signing:android
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KEYSTORE_NAME = 'yuanai-android-release.jks'
const CREDENTIALS_NAME = 'yuanai-android-release.json'
const GITHUB_SECRETS_NAME = 'yuanai-android-github-secrets.txt'
const KEY_ALIAS = 'yuanai-release'
const DEFAULT_DNAME = 'CN=YuanAI, OU=Development, O=YuanAI, L=Beijing, ST=Beijing, C=CN'

function createPassword() {
  return randomBytes(32).toString('base64url')
}

function restrictFile(path) {
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600)
  }
}

/**
 * 生成 Android PKCS#12 keystore 和 GitHub Actions Secret 导入材料。
 * @param {{ homeDir?: string, dname?: string, keytool?: string, spawn?: typeof spawnSync }} options 生成选项
 * @returns {{ keystorePath: string, credentialsPath: string, githubSecretsPath: string }} 本机私钥路径
 */
export function generateAndroidKeystore(options = {}) {
  const secretsDir = join(options.homeDir ?? homedir(), '.yuanai-secrets')
  const keystorePath = join(secretsDir, KEYSTORE_NAME)
  const credentialsPath = join(secretsDir, CREDENTIALS_NAME)
  const githubSecretsPath = join(secretsDir, GITHUB_SECRETS_NAME)
  const outputPaths = [keystorePath, credentialsPath, githubSecretsPath]

  if (outputPaths.some((path) => existsSync(path))) {
    throw new Error(`签名材料已存在于 ${secretsDir}；为避免覆盖私钥，已停止。`)
  }

  mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
  const storePassword = createPassword()
  // PKCS#12 不支持与 store password 不同的 key password。
  const keyPassword = storePassword
  const keytool = options.keytool ?? (process.platform === 'win32' ? 'keytool.exe' : 'keytool')
  const run = options.spawn ?? spawnSync
  const result = run(
    keytool,
    [
      '-genkeypair',
      '-v',
      '-keystore',
      keystorePath,
      '-storetype',
      'PKCS12',
      '-alias',
      KEY_ALIAS,
      '-keyalg',
      'RSA',
      '-keysize',
      '4096',
      '-validity',
      '10000',
      '-storepass',
      storePassword,
      '-keypass',
      keyPassword,
      '-dname',
      options.dname ?? DEFAULT_DNAME,
    ],
    { stdio: 'inherit' }
  )

  if (result.error) {
    throw new Error(`无法运行 keytool：${result.error.message}`)
  }
  if (result.status !== 0 || !existsSync(keystorePath)) {
    throw new Error('keytool 未能生成 Android keystore')
  }

  const credentials = {
    keystorePath,
    keyAlias: KEY_ALIAS,
    storePassword,
    keyPassword,
  }
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  const base64Keystore = readFileSync(keystorePath).toString('base64')
  writeFileSync(
    githubSecretsPath,
    [
      `ANDROID_KEYSTORE_BASE64=${base64Keystore}`,
      `ANDROID_KEY_ALIAS=${KEY_ALIAS}`,
      `ANDROID_KEYSTORE_PASSWORD=${storePassword}`,
      `ANDROID_KEY_PASSWORD=${keyPassword}`,
      '',
    ].join('\n'),
    { mode: 0o600 }
  )
  restrictFile(credentialsPath)
  restrictFile(githubSecretsPath)

  return { keystorePath, credentialsPath, githubSecretsPath }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateAndroidKeystore()
  console.log(`已生成 Android keystore：${result.keystorePath}`)
  console.log(`GitHub Secret 导入材料：${result.githubSecretsPath}`)
  console.log('私钥和密码只保存在 ~/.yuanai-secrets，请勿提交、上传或发送给他人。')
}
