import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopSection } from './DesktopSection'

const preferences = {
  closeToTray: true,
  globalShortcut: 'CommandOrControl+Alt+Y',
  autoLaunch: false,
  updateChannel: 'stable' as const,
  checkUpdatesAutomatically: true,
  nativeNotifications: true,
  notificationSound: true,
  aiReplyNotifications: true,
}

const setGlobalShortcut = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      system: {
        setGlobalShortcut,
      },
    },
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DesktopSection', () => {
  it('rolls back a shortcut field when registration conflicts', async () => {
    setGlobalShortcut.mockResolvedValue({
      accelerator: 'CommandOrControl+Alt+Y',
      errorCode: 'CONFLICT',
      registered: true,
    })
    const user = userEvent.setup()
    render(
      <DesktopSection
        preferences={preferences}
        onAutoLaunchChanged={vi.fn()}
        onPreferencesChanged={vi.fn()}
        onShortcutApplied={vi.fn()}
      />
    )

    const field = screen.getByLabelText('全局唤起快捷键')
    await user.clear(field)
    await user.type(field, 'CommandOrControl+Shift+Y')
    await user.click(screen.getByRole('button', { name: '应用快捷键' }))

    await waitFor(() => {
      expect(field).toHaveValue('CommandOrControl+Alt+Y')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('快捷键已被其他应用占用')
  })
})
