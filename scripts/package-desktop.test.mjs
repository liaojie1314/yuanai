import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTargetMenu,
  getAvailableTargets,
  parseTargetSelection,
  runPackageScript,
} from './package-desktop.mjs'

test('shows only the native target for each supported operating system', () => {
  assert.deepEqual(
    getAvailableTargets('linux').map((target) => target.id),
    ['linux']
  )
  assert.deepEqual(
    getAvailableTargets('darwin').map((target) => target.id),
    ['mac']
  )
  assert.deepEqual(
    getAvailableTargets('win32').map((target) => target.id),
    ['win']
  )
  assert.deepEqual(getAvailableTargets('freebsd'), [])
})

test('formats a menu with the existing package scripts', () => {
  const menu = formatTargetMenu(getAvailableTargets('linux'))
  assert.match(menu, /1\. Linux \(package:desktop:linux\)/)
})

test('accepts one-based selections and rejects invalid input', () => {
  assert.equal(parseTargetSelection(' 1 ', 1), 0)
  assert.throws(() => parseTargetSelection('', 1), /请选择/)
  assert.throws(() => parseTargetSelection('2', 1), /请选择/)
})

test('delegates packaging to pnpm run instead of electron-builder', () => {
  const calls = []
  const status = runPackageScript(
    { script: 'package:desktop:linux' },
    {
      platformName: 'linux',
      pnpmCommand: 'pnpm-test',
      spawn: (command, args, options) => {
        calls.push({ command, args, options })
        return { status: 0 }
      },
    }
  )
  assert.equal(status, 0)
  assert.deepEqual(calls[0].args, ['run', 'package:desktop:linux'])
})
