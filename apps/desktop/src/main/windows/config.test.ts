import { describe, expect, it } from 'vitest'

import { createWindowOptions } from './config'

describe('createWindowOptions', () => {
  it('creates every renderer window with hardened, initially hidden preferences', () => {
    const options = createWindowOptions('main', '/preload/index.js', 'linux')

    expect(options).toMatchObject({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: '/preload/index.js',
      },
    })
  })

  it('uses the documented per-entry size and macOS title bar style', () => {
    expect(createWindowOptions('oauth', '/preload/index.js', 'darwin')).toMatchObject({
      width: 420,
      height: 260,
      minWidth: 420,
      minHeight: 260,
      resizable: false,
      titleBarStyle: 'hiddenInset',
    })
  })
})
