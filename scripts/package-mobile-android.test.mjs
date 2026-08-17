import { strict as assert } from 'node:assert'
import test from 'node:test'

import { getAndroidArtifactPath, getAndroidSigningArgs } from './package-mobile-android.mjs'

test('returns the ignored Android release APK path', () => {
  assert.match(
    getAndroidArtifactPath(),
    /apps\/mobile\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk$/
  )
})

test('passes local release signing material only to Gradle', () => {
  assert.deepEqual(
    getAndroidSigningArgs({
      keystorePath: '/private/yuanai-release.jks',
      keyAlias: 'yuanai-release',
      storePassword: 'store-password',
      keyPassword: 'key-password',
    }),
    [
      '-Pandroid.injected.signing.store.file=/private/yuanai-release.jks',
      '-Pandroid.injected.signing.store.password=store-password',
      '-Pandroid.injected.signing.key.alias=yuanai-release',
      '-Pandroid.injected.signing.key.password=key-password',
      '-Pandroid.injected.signing.store.type=PKCS12',
    ]
  )
})
