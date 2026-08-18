import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
)
const releaseDocs = await readFile(new URL('../docs/release.md', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(
  await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')
)
const mobileEas = JSON.parse(
  await readFile(new URL('../apps/mobile/eas.json', import.meta.url), 'utf8')
)

test('release workflow accepts Expo project id from a variable or secret', () => {
  const expression = 'EXPO_PROJECT_ID: ${{ secrets.EXPO_PROJECT_ID || vars.EXPO_PROJECT_ID }}'
  assert.equal(workflow.split(expression).length - 1, 2)
  assert.match(releaseDocs, /GitHub Actions \*\*Secrets\*\*.*EXPO_PROJECT_ID/s)
  assert.match(releaseDocs, /Secret 缺失时回退读取 Variable/)
})

test('desktop release packages never let electron-builder publish from matrix jobs', () => {
  for (const target of ['win', 'mac', 'linux']) {
    assert.match(desktopPackage.scripts[`package:${target}`], /--publish never/)
  }
  assert.match(workflow, /run: pnpm --filter @yuanai\/desktop package:\$\{\{ matrix\.target \}\}$/m)
  assert.doesNotMatch(workflow, /package:\$\{\{ matrix\.target \}\} -- --publish never/)
  assert.doesNotMatch(
    workflow,
    /CSC_LINK: \$\{\{ matrix\.target == 'win' && secrets\.CSC_LINK \|\| '' \}\}/
  )
  assert.match(workflow, /if: matrix\.target == 'win'/)
  assert.match(workflow, /if: matrix\.target != 'win'/)
  assert.match(releaseDocs, /`--publish never`/)
})

test('Android release restores local EAS credentials from GitHub secrets', () => {
  assert.equal(mobileEas.build.production.credentialsSource, 'local')
  assert.match(workflow, /Restore Android signing credentials/)
  for (const secret of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`\\$\\{\\{ secrets\\.${secret} \\}\\}`))
    assert.match(releaseDocs, new RegExp('`' + secret + '`'))
  }
  assert.match(workflow, /base64 --decode/)
  assert.match(workflow, /apps\/mobile\/credentials\.json/)
  assert.match(workflow, /rm -f apps\/mobile\/credentials\.json/)
})
