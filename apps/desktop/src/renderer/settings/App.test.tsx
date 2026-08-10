import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  clearAll: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  deleteMe: vi.fn(),
  sendVerifyCode: vi.fn(),
  unlinkGithub: vi.fn(),
  unlinkGoogle: vi.fn(),
  updateMe: vi.fn(),
  updatePreferences: vi.fn(),
  uploadAvatar: vi.fn(),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useChangeEmail: () => ({ isPending: false, mutateAsync: hooks.changeEmail }),
  useChangePassword: () => ({ isPending: false, mutateAsync: hooks.changePassword }),
  useClearAllConversations: () => ({ isPending: false, mutateAsync: hooks.clearAll }),
  useCurrentUser: () => ({
    data: {
      id: 'user-1',
      email: 'test@example.com',
      username: 'tester',
      avatarUrl: null,
      bio: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    },
  }),
  useDeleteMe: () => ({ isPending: false, mutateAsync: hooks.deleteMe }),
  useMyPreferences: () => ({
    data: {
      theme: 'auto',
      fontSize: 'medium',
      density: 'standard',
      timeFormat: '24h',
      dateFormat: 'ymd',
      language: 'zh-CN',
    },
  }),
  useMyStats: () => ({ data: { conversationCount: 2, totalTokens: 256, fileCount: 1 } }),
  useSendVerifyCode: () => ({ isPending: false, mutateAsync: hooks.sendVerifyCode }),
  useUnlinkGithub: () => ({ isPending: false, mutateAsync: hooks.unlinkGithub }),
  useUnlinkGoogle: () => ({ isPending: false, mutateAsync: hooks.unlinkGoogle }),
  useUpdateMe: () => ({ isPending: false, mutateAsync: hooks.updateMe }),
  useUpdateMyPreferences: () => ({ isPending: false, mutateAsync: hooks.updatePreferences }),
  useUploadAvatar: () => ({ isPending: false, mutateAsync: hooks.uploadAvatar }),
}))

vi.mock('@yuanai/core/stores', () => ({
  usePrefsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      replaceAll: vi.fn(),
      setDateFmt: vi.fn(),
      setDensity: vi.fn(),
      setFontSize: vi.fn(),
      setTheme: vi.fn(),
      setTimeFmt: vi.fn(),
    }),
}))

import { App } from './App'

function installDesktopApi(): void {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      prefs: {
        get: vi.fn().mockResolvedValue({
          closeToTray: true,
          globalShortcut: 'CommandOrControl+Alt+Y',
          autoLaunch: false,
          updateChannel: 'stable',
          checkUpdatesAutomatically: true,
          nativeNotifications: true,
          notificationSound: true,
          aiReplyNotifications: true,
        }),
        update: vi.fn(),
      },
      shell: { openExternal: vi.fn() },
      system: {
        getInfo: vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.1' }),
        setAutoLaunch: vi.fn(),
        setGlobalShortcut: vi.fn(),
      },
    },
    writable: true,
  })
}

beforeEach(() => {
  installDesktopApi()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('desktop settings', () => {
  it('renders exactly the seven approved sections', async () => {
    render(<App />)

    const labels = [
      '个人资料',
      '账号安全',
      '外观与主题',
      '通知设置',
      '语言与地区',
      '桌面设置',
      '关于与帮助',
    ]

    expect(await screen.findAllByRole('tab')).toHaveLength(labels.length)
    for (const label of labels) {
      expect(screen.getByRole('tab', { name: label })).toHaveAccessibleName(label)
    }
  })
})
