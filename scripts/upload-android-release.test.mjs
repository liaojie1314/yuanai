import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  getAndroidReleaseAssetName,
  getAndroidReleaseArtifactPath,
  getReleaseUploadArgs,
  parseCliArgs,
  uploadAndroidRelease,
} from './upload-android-release.mjs'

test('accepts pnpm argument separator before the release tag', () => {
  assert.deepEqual(parseCliArgs(['--', 'v0.1.0']), ['v0.1.0'])
  assert.deepEqual(parseCliArgs(['v0.1.0']), ['v0.1.0'])
})

test('returns the local Android APK and descriptive release asset name', () => {
  assert.match(
    getAndroidReleaseArtifactPath(),
    /apps\/mobile\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk$/
  )
  assert.equal(getAndroidReleaseAssetName('v0.1.0'), 'YuanAI-v0.1.0-android.apk')
})

test('uploads the Android artifact with GitHub CLI and replaces a prior asset', () => {
  assert.deepEqual(getReleaseUploadArgs('v0.1.0', '/tmp/YuanAI-v0.1.0-android.apk'), [
    'release',
    'upload',
    'v0.1.0',
    '/tmp/YuanAI-v0.1.0-android.apk',
    '--clobber',
  ])
})

test('copies the local APK to the release asset name before invoking gh', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yuanai-release-upload-'))
  const source = join(directory, 'app-release.apk')
  writeFileSync(source, 'apk')
  const calls = []
  const status = uploadAndroidRelease('v0.1.0', source, {
    spawn: (command, args) => {
      calls.push({ command, args })
      return { status: 0 }
    },
  })

  assert.equal(status, 0)
  assert.equal(calls[0].command, 'gh')
  assert.match(calls[0].args[3], /YuanAI-v0\.1\.0-android\.apk$/)
  assert.match(calls[0].args[3], /yuanai-release-upload-/)
})
