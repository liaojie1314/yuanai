#!/usr/bin/env node
/**
 * 生成仅供 Windows 内测使用的自签名代码签名证书。
 * 证书和密码材料只写入当前用户的 ~/.yuanai-secrets，不进入仓库。
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CERTIFICATE_NAME = 'yuanai-windows-test.pfx'
const CREDENTIALS_NAME = 'yuanai-windows-test.json'
const SUBJECT = '/CN=YuanAI Test/O=YuanAI/OU=Development/C=CN'

function createPassword() {
  return randomBytes(32).toString('base64url')
}

function restrictFile(path) {
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}

function run(command, args, options) {
  const result = (options.spawn ?? spawnSync)(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`无法运行 ${command}：${result.error.message}`)
  if (result.status !== 0)
    throw new Error(`${command} 执行失败（退出码 ${result.status ?? 'unknown'}）`)
}

/**
 * 生成带有 codeSigning EKU 的 PKCS#12 测试证书。
 * @param {{ secretsDir?: string, openssl?: string, spawn?: typeof spawnSync }} options 证书生成选项
 * @returns {{ certificatePath: string, credentialsPath: string }} 证书和凭据路径
 */
export function generateDesktopTestCertificate(options = {}) {
  const secretsDir = options.secretsDir ?? join(homedir(), '.yuanai-secrets')
  const certificatePath = join(secretsDir, CERTIFICATE_NAME)
  const credentialsPath = join(secretsDir, CREDENTIALS_NAME)
  if (existsSync(certificatePath) || existsSync(credentialsPath)) {
    throw new Error(`桌面测试证书已存在于 ${secretsDir}；为避免覆盖私钥，已停止。`)
  }

  mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
  const password = createPassword()
  const temporaryPrefix = join(secretsDir, `.yuanai-desktop-test-${process.pid}`)
  const keyPath = `${temporaryPrefix}.key.pem`
  const certPath = `${temporaryPrefix}.cert.pem`
  const configPath = `${temporaryPrefix}.openssl.cnf`
  writeFileSync(
    configPath,
    [
      '[req]',
      'distinguished_name = req_distinguished_name',
      'x509_extensions = v3_code_signing',
      'prompt = no',
      '[req_distinguished_name]',
      'CN = YuanAI Test',
      'O = YuanAI',
      'OU = Development',
      'C = CN',
      '[v3_code_signing]',
      'basicConstraints = critical,CA:FALSE',
      'keyUsage = critical,digitalSignature',
      'extendedKeyUsage = codeSigning',
      '',
    ].join('\n'),
    { mode: 0o600 }
  )

  const openssl = options.openssl ?? (process.platform === 'win32' ? 'openssl.exe' : 'openssl')
  try {
    run(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-days',
        '825',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-config',
        configPath,
      ],
      options
    )
    run(
      openssl,
      [
        'pkcs12',
        '-export',
        '-out',
        certificatePath,
        '-inkey',
        keyPath,
        '-in',
        certPath,
        '-name',
        'YuanAI Test',
        '-passout',
        `pass:${password}`,
      ],
      options
    )
  } finally {
    for (const path of [keyPath, certPath, configPath]) {
      try {
        // Temporary private key material is removed before returning to the caller.
        unlinkSync(path)
      } catch {
        // Keep the primary certificate failure visible; cleanup is best effort.
      }
    }
  }

  const credentials = { certificatePath, password, subject: SUBJECT, purpose: 'test-only' }
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  restrictFile(certificatePath)
  restrictFile(credentialsPath)
  return { certificatePath, credentialsPath }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = generateDesktopTestCertificate()
  console.log(`已生成 Windows 内测自签名证书：${result.certificatePath}`)
  console.log(`密码材料：${result.credentialsPath}`)
  console.log('该证书不会获得 Windows 公共信任，仅用于本地或内部测试。')
}
