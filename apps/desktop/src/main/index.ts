import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'node:path'

import { readRuntimeConfig } from './config/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './ipc/guards'
import { setupIpc } from './ipc'
import { authStorage } from './storage/auth-storage'
import { preferencesStorage } from './storage/prefs-storage'
import { secureRenderer } from './security'
import { createWindowOptions } from './windows/config'
import { registerAppScheme } from './protocol/app-scheme'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yuanai-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const trustedWebContents = createTrustedWebContentsRegistry()

function createMainWindow(
  rendererUrl: string | undefined,
  runtimeConfig: ReturnType<typeof readRuntimeConfig>
): void {
  const win = new BrowserWindow(
    createWindowOptions('main', join(__dirname, '../preload/index.js'), process.platform)
  )
  trustedWebContents.add(win.webContents)
  secureRenderer(win.webContents, trustedWebContents, runtimeConfig)
  win.once('ready-to-show', () => win.show())

  if (rendererUrl) {
    void win.loadURL(new URL('main/index.html', `${rendererUrl}/`).toString())
  } else {
    void win.loadURL('yuanai-app://renderer/main/index.html')
  }
}

app.whenReady().then(() => {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const runtimeConfig = readRuntimeConfig()
  const unregisterAppScheme = registerAppScheme(protocol, join(__dirname, '../renderer'))
  setupIpc({
    ipcMain,
    guard: createIpcInvocationGuard({
      trustedWebContents,
      developmentRendererUrl: rendererUrl,
    }),
    trustedWebContents,
    authStorage,
    preferencesStorage,
    runtimeConfig,
  })
  createMainWindow(rendererUrl, runtimeConfig)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(rendererUrl, runtimeConfig)
  })
  app.once('before-quit', unregisterAppScheme)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
