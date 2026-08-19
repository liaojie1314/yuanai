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

test('release workflow prepares a commit-based release before build jobs', () => {
  assert.match(workflow, /^  prepare:/m)
  assert.match(workflow, /git log --no-merges --pretty=format:/)
  assert.match(workflow, /gh release create "\$RELEASE_TAG"/)
  assert.match(workflow, /gh api --method PATCH/)
  assert.match(workflow, /--notes-file release-notes\.md/)
  assert.match(releaseDocs, /Release 描述由目标版本的 Git\s*提交信息生成/)
})

test('web and desktop jobs upload directly to the prepared GitHub release', () => {
  assert.match(workflow, /needs: prepare/)
  assert.match(workflow, /uses: softprops\/action-gh-release@v2/)
  assert.match(workflow, /files: yuanai-web-\*\.tar\.gz/)
  assert.match(workflow, /apps\/desktop\/dist\/\*\.AppImage/)
  assert.match(workflow, /apps\/desktop\/dist\/\*\.deb/)
  assert.match(workflow, /apps\/desktop\/dist\/\*\.rpm/)
  assert.match(workflow, /files: apps\/desktop\/dist\/\*\.exe/)
  assert.match(workflow, /apps\/desktop\/dist\/\*\.dmg/)
  assert.match(workflow, /apps\/desktop\/dist\/\*\.zip/)
  assert.doesNotMatch(workflow, /^  publish:/m)
})

test('desktop release packages never let electron-builder publish from matrix jobs', () => {
  for (const target of ['win', 'mac', 'linux']) {
    assert.match(desktopPackage.scripts[`package:${target}`], /--publish never/)
  }
  assert.match(workflow, /run: pnpm --filter @yuanai\/desktop package:\$\{\{ matrix\.target \}\}$/m)
  assert.doesNotMatch(workflow, /package:\$\{\{ matrix\.target \}\} -- --publish never/)
  assert.match(workflow, /if: matrix\.target == 'win'/)
  assert.match(workflow, /if: matrix\.target != 'win'/)
  assert.match(releaseDocs, /`--publish never`/)
})

test('Android is packaged and uploaded locally instead of through EAS Actions', () => {
  assert.doesNotMatch(workflow, /mobile-android/)
  assert.doesNotMatch(workflow, /eas-build|EXPO_TOKEN|EXPO_PROJECT_ID|credentials\.json/)
  assert.doesNotMatch(workflow, /options: \[all, web, desktop, mobile\]/)
  assert.match(releaseDocs, /pnpm package:mobile:android/)
  assert.match(releaseDocs, /pnpm release:upload:android -- v0\.1\.0/)
})
