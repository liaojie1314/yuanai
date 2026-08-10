import { app, BrowserWindow, globalShortcut, ipcMain, Menu, protocol, shell } from 'electron'
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
import { DesktopSystemService } from './system/desktop-system'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yuanai-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const trustedWebContents = createTrustedWebContentsRegistry()
const pendingDeepLinks: ParsedDeepLink[] = []
let windowManager: WindowManager | undefined
let desktopSystem: DesktopSystemService | undefined

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
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const runtimeConfig = readRuntimeConfig()
  const unregisterAppScheme = registerAppScheme(protocol, join(__dirname, '../renderer'))
  windowManager = new WindowManager({
    createWindow: (entry) => {
      const window = new BrowserWindow(
        createWindowOptions(entry, join(__dirname, '../preload/index.js'), process.platform)
      )
      trustedWebContents.add(window.webContents)
      secureRenderer(window.webContents, trustedWebContents, runtimeConfig, Boolean(rendererUrl))
      window.once('ready-to-show', () => window.show())
      return window
    },
    rendererUrl,
  })
  desktopSystem = new DesktopSystemService({
    app,
    focusMain: () => windowManager?.focusMain(),
    globalShortcut,
    platform: process.platform,
    preferencesStorage,
  })
  setupIpc({
    ipcMain,
    guard: createIpcInvocationGuard({
      trustedWebContents,
      developmentRendererUrl: rendererUrl,
    }),
    trustedWebContents,
    authStorage,
    onSessionChanged: (hasSession) => {
      if (!windowManager) return
      if (hasSession) {
        windowManager.open('main')
        windowManager.close('login')
        windowManager.close('register')
        windowManager.close('forgot')
        return
      }
      windowManager.open('login')
      windowManager.close('main')
    },
    preferencesStorage,
    runtimeConfig,
    shell,
    systemService: desktopSystem,
    windows: {
      openSettings: () => windowManager?.open('settings'),
      openAbout: () => windowManager?.open('about'),
    },
  })
  void desktopSystem.restore().catch((error: unknown) => {
    console.error('Desktop system preference restore failed', error)
  })
  void authStorage
    .getItem('yuanai-auth')
    .then((session) => windowManager?.open(session ? 'main' : 'login'))
    .catch(() => windowManager?.open('login'))
  flushDeepLinks()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowManager?.focusMain()
  })
  app.once('before-quit', () => {
    desktopSystem?.dispose()
    unregisterAppScheme()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
