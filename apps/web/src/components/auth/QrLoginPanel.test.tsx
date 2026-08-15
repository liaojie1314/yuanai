import { act, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh-CN.json'

const qrApi = vi.hoisted(() => ({
  create: vi.fn(),
  exchange: vi.fn(),
  getStatus: vi.fn(),
}))

const auth = vi.hoisted(() => ({ setAuth: vi.fn() }))

vi.mock('@yuanai/core/api', () => ({
  createQrLoginChallenge: qrApi.create,
  exchangeQrLoginChallenge: qrApi.exchange,
  getQrLoginStatus: qrApi.getStatus,
}))

vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}))

import { QrLoginPanel } from './QrLoginPanel'

const challenge = {
  challenge: 'x'.repeat(43),
  pollSecret: 'y'.repeat(43),
  qrDataUri: 'data:image/png;base64,test',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  pollAfterMs: 1000,
}

function renderPanel(onBack = vi.fn(), onAuthenticated = vi.fn()): void {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
      <QrLoginPanel
        deviceName="Firefox on Ubuntu"
        onBack={onBack}
        onAuthenticated={onAuthenticated}
      />
    </NextIntlClientProvider>
  )
}

describe('QrLoginPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    qrApi.create.mockResolvedValue(challenge)
    qrApi.getStatus.mockResolvedValue({
      status: 'approved',
      expiresAt: challenge.expiresAt,
      authorizationCode: 'z'.repeat(43),
    })
    qrApi.exchange.mockResolvedValue({
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      user: {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        avatarUrl: null,
        createdAt: '2026-08-15T00:00:00Z',
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('展示真实二维码，并在获批后仅交换一次会话', async () => {
    const onAuthenticated = vi.fn()
    renderPanel(vi.fn(), onAuthenticated)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('img', { name: '扫码登录二维码' })).toHaveAttribute(
      'src',
      challenge.qrDataUri
    )
    expect(screen.getByRole('button', { name: '使用账号密码登录' }).parentElement).toHaveClass(
      'qr-actions'
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
    })

    expect(qrApi.exchange).toHaveBeenCalledOnce()
    expect(auth.setAuth).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'access',
      'refresh',
      true
    )
    expect(onAuthenticated).toHaveBeenCalledOnce()
  })

  it('返回登录表单后清理轮询，不再请求二维码状态', async () => {
    const onBack = vi.fn()
    renderPanel(onBack)
    await act(async () => {
      await Promise.resolve()
    })
    screen.getByRole('img', { name: '扫码登录二维码' })

    fireEvent.click(screen.getByRole('button', { name: '使用账号密码登录' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(onBack).toHaveBeenCalledOnce()
    expect(qrApi.getStatus).not.toHaveBeenCalled()
  })

  it('挑战过期后允许刷新并替换二维码', async () => {
    qrApi.create
      .mockResolvedValueOnce({ ...challenge, expiresAt: new Date(Date.now() - 1).toISOString() })
      .mockResolvedValueOnce({ ...challenge, qrDataUri: 'data:image/png;base64,refreshed' })
    renderPanel()
    await act(async () => {
      await Promise.resolve()
    })
    screen.getByRole('img', { name: '扫码登录二维码' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('二维码已过期')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(qrApi.create).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img', { name: '扫码登录二维码' })).toHaveAttribute(
      'src',
      'data:image/png;base64,refreshed'
    )
  })

  it('刷新失败时保留当前二维码并显示限流原因', async () => {
    qrApi.create
      .mockResolvedValueOnce(challenge)
      .mockRejectedValueOnce({ response: { status: 429 } })
    renderPanel()
    await act(async () => {
      await Promise.resolve()
    })
    const code = screen.getByRole('img', { name: '扫码登录二维码' })

    fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
    expect(code).toHaveAttribute('src', challenge.qrDataUri)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('二维码刷新过于频繁，请稍后再试')).toBeInTheDocument()
    expect(code).toHaveAttribute('src', challenge.qrDataUri)
  })
})
