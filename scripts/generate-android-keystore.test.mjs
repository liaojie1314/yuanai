import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { generateAndroidKeystore } from './generate-android-keystore.mjs'

test('生成 keystore 并把 GitHub Secret 材料限制在用户目录', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'yuanai-android-signing-'))
  const result = generateAndroidKeystore({
    homeDir,
    keytool: 'keytool-test',
    spawn: (_command, args) => {
      const targetIndex = args.indexOf('-keystore')
      const target = args[targetIndex + 1]
      assert.equal(args[0], '-genkeypair')
      assert.equal(args[args.indexOf('-storetype') + 1], 'PKCS12')
      assert.equal(args[args.indexOf('-keysize') + 1], '4096')
      writeFileSync(target, 'test-keystore')
      return { status: 0 }
    },
  })

  assert.match(result.keystorePath, /\.yuanai-secrets\/yuanai-android-release\.jks$/)
  assert.ok(existsSync(result.credentialsPath))
  assert.ok(existsSync(result.githubSecretsPath))
})

test('拒绝覆盖已有的 Android 私钥材料', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'yuanai-android-signing-existing-'))
  const secretsDir = join(homeDir, '.yuanai-secrets')
  generateAndroidKeystore({
    homeDir,
    spawn: (_command, args) => {
      writeFileSync(args[args.indexOf('-keystore') + 1], 'test-keystore')
      return { status: 0 }
    },
  })
  assert.throws(() => generateAndroidKeystore({ homeDir }), /签名材料已存在/)
})
