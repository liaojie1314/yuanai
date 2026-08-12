import { describe, expect, it, vi } from 'vitest'

import { createTrayController } from './index'
import type { NativeTray, TrayMenuBuilder } from './index'

describe('createTrayController', () => {
  it('opens the main window from the icon and exposes settings and quit actions', () => {
    let onClick: (() => void) | undefined
    const destroy = vi.fn()
    const setContextMenu = vi.fn()
    const setToolTip = vi.fn()
    const tray: NativeTray = {
      destroy,
      on: (event, listener) => {
        if (event === 'click') onClick = listener
        return tray
      },
      setContextMenu,
      setToolTip,
    }
    const createTray = vi.fn(() => tray)
    let template: Electron.MenuItemConstructorOptions[] | undefined
    const menu: TrayMenuBuilder = {
      buildFromTemplate: (items) => {
        template = items
        return {} as Electron.Menu
      },
    }
    const onOpenSettings = vi.fn()
    const onQuit = vi.fn()
    const onShowMain = vi.fn()

    const controller = createTrayController({
      createTray,
      icon: {} as Electron.NativeImage,
      menu,
      onOpenSettings,
      onQuit,
      onShowMain,
    })

    expect(setToolTip).toHaveBeenCalledWith('元AI')
    expect(template?.map(({ label, type }) => ({ label, type }))).toEqual([
      { label: '显示元AI', type: undefined },
      { label: '打开设置', type: undefined },
      { label: undefined, type: 'separator' },
      { label: '退出元AI', type: undefined },
    ])

    onClick?.()
    expect(onShowMain).toHaveBeenCalledOnce()

    const openSettings = template?.[1]
    const quit = template?.[3]
    if (openSettings?.type !== 'separator') {
      openSettings?.click?.(
        {} as Electron.MenuItem,
        {} as Electron.BrowserWindow,
        {} as KeyboardEvent
      )
    }
    if (quit?.type !== 'separator') {
      quit?.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent)
    }
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onQuit).toHaveBeenCalledOnce()

    controller.dispose()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
