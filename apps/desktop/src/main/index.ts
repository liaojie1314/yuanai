import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
  Tray,
} from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'

import { readRuntimeConfig } from './config/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './ipc/guards'
import { setupIpc } from './ipc'
import { authStorage } from './storage/auth-storage'
import { preferencesStorage } from './storage/prefs-storage'
import { secureRenderer } from './security'
import { InAppMediaPermissionPrompt } from './security/in-app-permission-prompt'
import { createWindowOptions } from './windows/config'
import { WindowManager } from './windows/manager'
import { createDesktopActionRegistry } from './actions/registry'
import { registerAppScheme } from './protocol/app-scheme'
import { createSelectedFileRegistry, registerSelectedFileScheme } from './protocol/selected-file'
import { IPC } from '../shared/ipc-contract'
import { parseDeepLink, type ParsedDeepLink } from './protocol/parser'
import { DesktopSystemService } from './system/desktop-system'
import { DesktopAppearanceService } from './system/desktop-appearance'
import { DesktopUpdaterService } from './system/desktop-updater'
import { createTrayController, type TrayController } from './tray'
import { installCloseToTrayBehavior } from './windows/close-to-tray'
import { ExecutionNodeGrantStore } from './execution-node/grants'
import { ExecutionNodeIdentityStore } from './execution-node/identity-store'
import { ExecutionNodeService } from './execution-node/service'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yuanai-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'yuanai-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const trustedWebContents = createTrustedWebContentsRegistry()
const pendingDeepLinks: ParsedDeepLink[] = []
let windowManager: WindowManager | undefined
let desktopSystem: DesktopSystemService | undefined
let desktopAppearance: DesktopAppearanceService | undefined
let desktopUpdater: DesktopUpdaterService | undefined
let executionNodeService: ExecutionNodeService | undefined
let trayController: TrayController | undefined
let isQuitting = false

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(__dirname, '../../../mobile/assets/icon.png')
}

function quitApplication(): void {
  isQuitting = true
  app.quit()
}

function handleDeepLink(value: string): void {
  const deepLink = parseDeepLink(value)
  if (!deepLink) return
  if (windowManager) {
    dispatchDeepLink(deepLink)
  } else {
    pendingDeepLinks.push(deepLink)
  }
}

function dispatchDeepLink(deepLink: ParsedDeepLink): void {
  if (!windowManager) return
  if (deepLink.type === 'oauth' || deepLink.type === 'oauth-error') {
    windowManager.sendWhenReady('oauth', IPC.events.oauthResult, deepLink)
    return
  }
  windowManager.sendWhenReady('main', IPC.events.deepLink, deepLink)
}

function flushDeepLinks(): void {
  if (!windowManager) return
  for (const deepLink of pendingDeepLinks.splice(0)) {
    dispatchDeepLink(deepLink)
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
  const selectedFiles = createSelectedFileRegistry()
  const unregisterSelectedFileScheme = registerSelectedFileScheme(protocol, selectedFiles)
  const mediaPermissionPrompt = new InAppMediaPermissionPrompt()
  windowManager = new WindowManager({
    createWindow: (key) => {
      const window = new BrowserWindow(
        createWindowOptions(key, join(__dirname, '../preload/index.js'), process.platform)
      )
      desktopAppearance?.applyToWindow(window)
      trustedWebContents.add(window.webContents)
      secureRenderer(
        window.webContents,
        trustedWebContents,
        runtimeConfig,
        Boolean(rendererUrl),
        key === 'main' ? mediaPermissionPrompt.prompt : () => Promise.resolve(false)
      )
      if (key === 'main') {
        installCloseToTrayBehavior({
          isQuitting: () => isQuitting,
          onQuit: quitApplication,
          preferencesStorage,
          window,
        })
      }
      window.once('ready-to-show', () => window.show())
      return window
    },
    rendererUrl,
  })
  desktopSystem = new DesktopSystemService({
    app,
    actionRegistry: createDesktopActionRegistry({
      toggleMainWindow: () => windowManager?.toggleMainWindow(),
    }),
    globalShortcut,
    platform: process.platform,
    preferencesStorage,
    notifications: {
      isSupported: () => Notification.isSupported(),
      show: ({ title, body, conversationId, playSound }) => {
        const notification = new Notification({ title, body, silent: !playSound })
        if (conversationId) notification.on('click', () => windowManager?.focusMain())
        notification.show()
      },
    },
  })
  desktopAppearance = new DesktopAppearanceService({
    nativeTheme,
    getWindows: () => BrowserWindow.getAllWindows(),
    onChanged: (state) =>
      trustedWebContents.forEach((webContents) =>
        webContents.send(IPC.events.appearanceChanged, state)
      ),
  })
  desktopAppearance.start()
  desktopUpdater = new DesktopUpdaterService({
    app,
    updater: autoUpdater,
    preferencesStorage,
    onStatus: (status) =>
      trustedWebContents.forEach((webContents) => webContents.send(IPC.events.updater, status)),
  })
  trayController = createTrayController({
    createTray: (icon) => new Tray(icon),
    icon: nativeImage.createFromPath(trayIconPath()),
    menu: Menu,
    onOpenSettings: () => windowManager?.open('settings'),
    onQuit: quitApplication,
    onShowMain: () => windowManager?.focusMain(),
  })
  const executionNodeIdentityStore = new ExecutionNodeIdentityStore({ app, safeStorage })
  const executionNodeGrants = new ExecutionNodeGrantStore({ app, safeStorage })
  executionNodeService = new ExecutionNodeService({
    identityStore: executionNodeIdentityStore,
    grants: executionNodeGrants,
    runtimeConfig,
    app,
    dialog,
    shell,
    onStatus: (status) =>
      trustedWebContents.forEach((webContents) =>
        webContents.send(IPC.events.executionNode, status)
      ),
  })
  setupIpc({
    ipcMain,
    guard: createIpcInvocationGuard({
      trustedWebContents,
      developmentRendererUrl: rendererUrl,
    }),
    trustedWebContents,
    authStorage,
    clipboard,
    desktopCapturer,
    dialog,
    getWindow: (webContents) => BrowserWindow.fromWebContents(webContents),
    onSessionChanged: (hasSession) => {
      if (!windowManager) return
      if (hasSession) {
        windowManager.open('main')
        windowManager.close('login')
        windowManager.close('register')
        windowManager.close('forgot')
        windowManager.close('oauth')
        return
      }
      windowManager.open('login')
      windowManager.close('main')
    },
    preferencesStorage,
    runtimeConfig,
    selectedFiles,
    mediaPermissionPrompt,
    appearanceService: desktopAppearance,
    shell,
    systemService: desktopSystem,
    updaterService: desktopUpdater,
    executionNodeService,
    windows: {
      openLogin: () => windowManager?.open('login'),
      openRegister: () => windowManager?.open('register'),
      openForgot: () => windowManager?.open('forgot'),
      openSettings: () => windowManager?.open('settings'),
      openAbout: () => windowManager?.open('about'),
      openArtifact: (payload) => windowManager?.openArtifact(payload),
      openOAuth: () => windowManager?.open('oauth'),
      closeOAuth: () => windowManager?.close('oauth'),
    },
  })
  void desktopSystem.restore().catch((error: unknown) => {
    console.error('Desktop system preference restore failed', error)
  })
  void desktopUpdater.start().catch((error: unknown) => {
    console.error('Desktop updater startup failed', error)
  })
  void executionNodeService.start().catch((error: unknown) => {
    console.error('Execution node startup failed', error)
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
    isQuitting = true
    trayController?.dispose()
    desktopSystem?.dispose()
    desktopAppearance?.dispose()
    mediaPermissionPrompt.dispose()
    executionNodeService?.stop()
    unregisterAppScheme()
    unregisterSelectedFileScheme()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
