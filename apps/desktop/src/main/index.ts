import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

import { readRuntimeConfig } from './config/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './ipc/guards'
import { setupIpc } from './ipc'
import { authStorage } from './storage/auth-storage'
import { preferencesStorage } from './storage/prefs-storage'

const trustedWebContents = createTrustedWebContentsRegistry()

function createMainWindow(rendererUrl: string | undefined): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  })
  trustedWebContents.add(win.webContents)

  if (rendererUrl) {
    void win.loadURL(new URL('main/index.html', `${rendererUrl}/`).toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/main/index.html'))
  }
}

app.whenReady().then(() => {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const runtimeConfig = readRuntimeConfig()
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
  createMainWindow(rendererUrl)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(rendererUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
