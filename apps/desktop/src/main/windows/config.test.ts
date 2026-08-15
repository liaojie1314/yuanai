import { describe, expect, it } from 'vitest'

import { createWindowOptions } from './config'

describe('createWindowOptions', () => {
  it('creates every renderer window with hardened, initially hidden preferences', () => {
    const options = createWindowOptions('main', '/preload/index.js', 'linux')

    expect(options).toMatchObject({
      width: 1280,
      height: 820,
      minWidth: 1280,
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

  it('uses a renderer-owned title bar for Linux so its colors follow the application theme', () => {
    expect(createWindowOptions('settings', '/preload/index.js', 'linux')).toMatchObject({
      frame: false,
    })
  })

  it('uses enough fixed height for the login form and QR entry', () => {
    expect(createWindowOptions('login', '/preload/index.js', 'linux')).toMatchObject({
      width: 520,
      height: 680,
      minWidth: 520,
      minHeight: 680,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
    })
  })

  it('uses a taller fixed size for the complete registration form', () => {
    expect(createWindowOptions('register', '/preload/index.js', 'linux')).toMatchObject({
      width: 520,
      height: 810,
      minWidth: 520,
      minHeight: 810,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
    })
  })

  it('uses an intermediate fixed height for password recovery', () => {
    expect(createWindowOptions('forgot', '/preload/index.js', 'linux')).toMatchObject({
      width: 520,
      height: 680,
      minWidth: 520,
      minHeight: 680,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
    })
  })
})
