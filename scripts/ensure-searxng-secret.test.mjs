import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./ensure-searxng-secret.mjs', import.meta.url))

test('creates one reusable local SearXNG secret without printing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yuanai-searxng-'))
  const envFile = join(directory, '.env')
  const run = () =>
    spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, YUANAI_SEARCH_ENV_FILE: envFile },
    })

  const first = run()
  assert.equal(first.status, 0)
  const initial = await readFile(envFile, 'utf8')
  assert.match(initial, /^SEARXNG_SECRET=[a-f0-9]{64}$/m)
  assert.doesNotMatch(first.stdout, /[a-f0-9]{64}/)

  const second = run()
  assert.equal(second.status, 0)
  assert.equal(await readFile(envFile, 'utf8'), initial)

  await writeFile(envFile, 'SEARXNG_SECRET=malformed\n')
  const malformed = run()
  assert.notEqual(malformed.status, 0)
})
