import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setApiBaseUrl } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

import { App } from '../../src/renderer/login/App'

const API_BASE_URL = 'http://desktop.test/api/v1'

const server = setupServer()

function renderAuthApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

beforeEach(async () => {
  setApiBaseUrl(API_BASE_URL)
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  await useAuthStore.persist.clearStorage()
  window.history.replaceState(null, '', '#/login')
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())

describe('desktop authentication integration', () => {
  it('persists a Core auth session after a successful login response', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          user: {
            id: 'user-1',
            email: 'test@example.com',
            username: 'tester',
            avatarUrl: null,
            createdAt: '2026-08-10T00:00:00.000Z',
          },
        })
      )
    )
    const user = userEvent.setup()
    renderAuthApp()

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'Test1234!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(useAuthStore.getState()).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { email: 'test@example.com' },
      })
    })
  })

  it('keeps the user on the login form and displays an API error for rejected credentials', async () => {
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          { detail: { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码错误' } },
          { status: 401 }
        )
      )
    )
    const user = userEvent.setup()
    renderAuthApp()

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'WrongPass1!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误')
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
