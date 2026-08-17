import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { syncVersions } from './sync-version.mjs'

const PACKAGE_PATHS = [
  'apps/web/package.json',
  'apps/mobile/package.json',
  'apps/desktop/package.json',
  'packages/core/package.json',
  'packages/types/package.json',
  'packages/ui/package.json',
]

test('同步所有 workspace 清单与 Expo 版本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yuanai-version-'))
  await mkdir(join(root, 'apps/mobile'), { recursive: true })
  await mkdir(join(root, 'apps/web'), { recursive: true })
  await mkdir(join(root, 'apps/desktop'), { recursive: true })
  await mkdir(join(root, 'packages/core'), { recursive: true })
  await mkdir(join(root, 'packages/types'), { recursive: true })
  await mkdir(join(root, 'packages/ui'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{"version":"1.2.3"}\n')
  for (const relativePath of PACKAGE_PATHS) {
    await writeFile(join(root, relativePath), '{"name":"test","version":"0.0.1"}\n')
  }
  await writeFile(
    join(root, 'apps/mobile/app.json'),
    '{"expo":{"version":"0.0.1","android":{"versionCode":1},"ios":{"buildNumber":"1"}}}\n'
  )

  assert.equal(syncVersions(root, { syncNativeBuild: true }), '1.2.3')
  for (const relativePath of PACKAGE_PATHS) {
    const value = JSON.parse(await readFile(join(root, relativePath), 'utf8'))
    assert.equal(value.version, '1.2.3')
  }
  const appJson = JSON.parse(await readFile(join(root, 'apps/mobile/app.json'), 'utf8'))
  assert.equal(appJson.expo.version, '1.2.3')
  assert.equal(appJson.expo.android.versionCode, 1_002_003)
  assert.equal(appJson.expo.ios.buildNumber, '1002003')
})

test('根清单缺少版本时拒绝同步', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yuanai-version-invalid-'))
  await writeFile(join(root, 'package.json'), '{}\n')
  assert.throws(() => syncVersions(root), /缺少有效 version/)
})
