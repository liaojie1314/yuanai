import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  qrDataUri: 'data:image/png;base64,desktop',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  pollAfterMs: 1000,
}

describe('Desktop QrLoginPanel', () => {
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
    cleanup()
    vi.useRealTimers()
  })

  it('展示真实二维码，批准后使用普通认证状态写入会话', async () => {
    render(<QrLoginPanel onBack={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('img', { name: '扫码登录二维码' })).toHaveAttribute(
      'src',
      challenge.qrDataUri
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
  })

  it('返回后停止等待状态且不会继续轮询', async () => {
    const onBack = vi.fn()
    render(<QrLoginPanel onBack={onBack} />)
    await act(async () => {
      await Promise.resolve()
    })
    screen.getByRole('img', { name: '扫码登录二维码' })

    fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(onBack).toHaveBeenCalledOnce()
    expect(qrApi.getStatus).not.toHaveBeenCalled()
  })

  it('刷新失败时保留现有二维码并说明请求受限', async () => {
    qrApi.create
      .mockResolvedValueOnce(challenge)
      .mockRejectedValueOnce({ response: { status: 429 } })
    render(<QrLoginPanel onBack={vi.fn()} />)
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
