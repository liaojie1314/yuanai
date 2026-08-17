import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { generateDesktopTestCertificate } from './generate-desktop-test-certificate.mjs'

test('生成受限于用户目录的 Windows 测试证书', () => {
  const secretsDir = mkdtempSync(join(tmpdir(), 'yuanai-desktop-signing-'))
  const result = generateDesktopTestCertificate({ secretsDir })
  assert.ok(existsSync(result.certificatePath))
  const credentials = JSON.parse(readFileSync(result.credentialsPath, 'utf8'))
  assert.equal(credentials.purpose, 'test-only')
  assert.equal(credentials.certificatePath, result.certificatePath)
})

test('拒绝覆盖已有的桌面测试私钥材料', () => {
  const secretsDir = mkdtempSync(join(tmpdir(), 'yuanai-desktop-signing-existing-'))
  generateDesktopTestCertificate({ secretsDir })
  assert.throws(() => generateDesktopTestCertificate({ secretsDir }), /证书已存在/)
})
