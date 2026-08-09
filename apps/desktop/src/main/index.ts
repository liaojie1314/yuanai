import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'node:path'

import { readRuntimeConfig } from './config/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './ipc/guards'
import { setupIpc } from './ipc'
import { authStorage } from './storage/auth-storage'
import { preferencesStorage } from './storage/prefs-storage'
import { secureRenderer } from './security'
import { createWindowOptions } from './windows/config'
import { WindowManager } from './windows/manager'
import { registerAppScheme } from './protocol/app-scheme'
import { IPC } from '../shared/ipc-contract'
import { parseDeepLink, type ParsedDeepLink } from './protocol/parser'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yuanai-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const trustedWebContents = createTrustedWebContentsRegistry()
const pendingDeepLinks: ParsedDeepLink[] = []
let windowManager: WindowManager | undefined

function handleDeepLink(value: string): void {
  const deepLink = parseDeepLink(value)
  if (!deepLink) return
  if (windowManager) {
    windowManager.sendWhenReady('main', IPC.events.deepLink, deepLink)
  } else {
    pendingDeepLinks.push(deepLink)
  }
}

function flushDeepLinks(): void {
  if (!windowManager) return
  for (const deepLink of pendingDeepLinks.splice(0)) {
    windowManager.sendWhenReady('main', IPC.events.deepLink, deepLink)
  }
}

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', (_event, commandLine) => {
  const deepLink = commandLine.find((argument) => argument.startsWith('yuanai://'))
  if (deepLink) handleDeepLink(deepLink)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.whenReady().then(() => {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const runtimeConfig = readRuntimeConfig()
  const unregisterAppScheme = registerAppScheme(protocol, join(__dirname, '../renderer'))
  windowManager = new WindowManager({
    createWindow: (entry) => {
      const window = new BrowserWindow(
        createWindowOptions(entry, join(__dirname, '../preload/index.js'), process.platform)
      )
      trustedWebContents.add(window.webContents)
      secureRenderer(window.webContents, trustedWebContents, runtimeConfig)
      window.once('ready-to-show', () => window.show())
      return window
    },
    rendererUrl,
  })
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
  void authStorage
    .getItem('yuanai-auth')
    .then((session) => windowManager?.open(session ? 'main' : 'login'))
    .catch(() => windowManager?.open('login'))
  flushDeepLinks()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowManager?.focusMain()
  })
  app.once('before-quit', unregisterAppScheme)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
