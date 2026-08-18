import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
)
const releaseDocs = await readFile(new URL('../docs/release.md', import.meta.url), 'utf8')

test('release workflow accepts Expo project id from a variable or secret', () => {
  const expression = 'EXPO_PROJECT_ID: ${{ secrets.EXPO_PROJECT_ID || vars.EXPO_PROJECT_ID }}'
  assert.equal(workflow.split(expression).length - 1, 2)
  assert.match(releaseDocs, /GitHub Actions \*\*Secrets\*\*.*EXPO_PROJECT_ID/s)
  assert.match(releaseDocs, /Secret 缺失时回退读取 Variable/)
})

test('desktop release packages never let electron-builder publish from matrix jobs', () => {
  const command =
    'run: pnpm --filter @yuanai/desktop package:${{ matrix.target }} -- --publish never'
  assert.equal(workflow.split(command).length - 1, 2)
  assert.doesNotMatch(workflow, /run: pnpm package:desktop:\$\{\{ matrix\.target \}\}/)
  assert.doesNotMatch(
    workflow,
    /CSC_LINK: \$\{\{ matrix\.target == 'win' && secrets\.CSC_LINK \|\| '' \}\}/
  )
  assert.match(workflow, /if: matrix\.target == 'win'/)
  assert.match(workflow, /if: matrix\.target != 'win'/)
  assert.match(releaseDocs, /`--publish never`/)
})
