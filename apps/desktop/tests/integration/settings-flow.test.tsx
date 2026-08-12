import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { setApiBaseUrl } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

import { App } from '../../src/renderer/settings/App'

const API_BASE_URL = 'http://desktop-settings.test/api/v1'
let updatedProfile: Record<string, unknown> | null = null
let updatedPreferences: Record<string, unknown> | null = null
const server = setupServer(
  http.get(`${API_BASE_URL}/auth/me`, () =>
    HttpResponse.json({
      id: 'user-1',
      email: 'test@example.com',
      username: 'desktop-user',
      avatarUrl: null,
      bio: '桌面端用户',
      createdAt: '2026-08-10T00:00:00.000Z',
    })
  ),
  http.get(`${API_BASE_URL}/auth/me/preferences`, () =>
    HttpResponse.json({
      theme: 'auto',
      fontSize: 'medium',
      density: 'standard',
      timeFormat: '24h',
      dateFormat: 'ymd',
      language: 'zh-CN',
    })
  ),
  http.get(`${API_BASE_URL}/auth/me/stats`, () =>
    HttpResponse.json({ conversationCount: 3, totalTokens: 1024, fileCount: 2 })
  ),
  http.patch(`${API_BASE_URL}/auth/me`, async ({ request }) => {
    updatedProfile = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({
      id: 'user-1',
      email: 'test@example.com',
      username: updatedProfile['username'] ?? 'desktop-user',
      avatarUrl: null,
      bio: updatedProfile['bio'] ?? '桌面端用户',
      createdAt: '2026-08-10T00:00:00.000Z',
    })
  }),
  http.patch(`${API_BASE_URL}/auth/me/preferences`, async ({ request }) => {
    updatedPreferences = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({
      theme: updatedPreferences['theme'] ?? 'auto',
      fontSize: 'medium',
      density: 'standard',
      timeFormat: '24h',
      dateFormat: 'ymd',
      language: 'zh-CN',
    })
  })
)

function renderSettings(): void {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(() => {
  updatedProfile = null
  updatedPreferences = null
  setApiBaseUrl(API_BASE_URL)
  useAuthStore.setState({ accessToken: 'desktop-test-token', refreshToken: null, user: null })
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
      appearance: {
        get: vi.fn().mockResolvedValue({ choice: 'auto', resolved: 'light' }),
        apply: vi.fn().mockResolvedValue({ choice: 'auto', resolved: 'light' }),
        syncPreferences: vi.fn().mockResolvedValue(undefined),
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
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())

describe('desktop settings integration', () => {
  it('loads a profile and persists a profile edit through the Core API client', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findAllByText('desktop-user')
    await user.click(screen.getByRole('button', { name: '编辑昵称' }))
    const username = screen.getByRole('textbox', { name: '昵称' })
    expect(username).toHaveValue('desktop-user')
    await user.clear(username)
    await user.type(username, 'desktop_admin')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(updatedProfile).toEqual({ bio: '桌面端用户', username: 'desktop_admin' })
    })
    expect(screen.getByRole('status')).toHaveTextContent('资料已保存')
  })

  it('synchronizes a theme selection to the native window and real preferences API', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('tab', { name: '外观与主题' }))
    await user.click(screen.getByRole('radio', { name: '深色' }))

    await waitFor(() => {
      expect(updatedPreferences).toEqual({ theme: 'dark' })
    })
    expect(window.yuanai.appearance.apply).toHaveBeenCalledWith('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByText('偏好设置已保存')).toHaveAttribute('role', 'status')
  })

  it('restores the renderer and native theme when the preferences API rejects a change', async () => {
    server.use(
      http.patch(`${API_BASE_URL}/auth/me/preferences`, () =>
        HttpResponse.json({ message: '保存失败' }, { status: 500 })
      )
    )
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('tab', { name: '外观与主题' }))
    await user.click(screen.getByRole('radio', { name: '深色' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status code 500')
    })
    expect(window.yuanai.appearance.apply).toHaveBeenNthCalledWith(1, 'dark')
    expect(window.yuanai.appearance.apply).toHaveBeenLastCalledWith('auto')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(screen.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true')
  })
})
