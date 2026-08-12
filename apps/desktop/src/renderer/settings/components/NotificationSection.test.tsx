import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationSection } from './NotificationSection'

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

const notify = vi.fn<() => Promise<boolean>>()

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: { system: { notify } },
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotificationSection', () => {
  it('sends a native notification through the desktop bridge and reports the outcome', async () => {
    notify.mockResolvedValue(true)
    const user = userEvent.setup()
    render(<NotificationSection preferences={preferences} onPreferencesChanged={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '测试通知' }))

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        title: 'AI 回复已完成',
        body: '这是一次元AI 通知测试。',
      })
    })
    expect(screen.getByRole('status')).toHaveTextContent('测试通知已发送')
  })

  it('makes disabled notification delivery visible instead of claiming success', async () => {
    notify.mockResolvedValue(false)
    const user = userEvent.setup()
    render(<NotificationSection preferences={preferences} onPreferencesChanged={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '测试通知' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '请先开启原生通知和 AI 回复完成提醒'
    )
  })
})
