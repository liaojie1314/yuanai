import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mutations = vi.hoisted(() => ({
  login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  register: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  resetPassword: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendVerifyCode: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useLogin: () => ({ isPending: false, mutateAsync: mutations.login }),
  useRegister: () => ({ isPending: false, mutateAsync: mutations.register }),
  useResetPassword: () => ({ isPending: false, mutateAsync: mutations.resetPassword }),
  useSendVerifyCode: () => ({ isPending: false, mutateAsync: mutations.sendVerifyCode }),
}))

import { App } from './App'

function setAuthRoute(route: 'login' | 'register' | 'forgot'): void {
  window.history.replaceState(null, '', `#/${route}`)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setAuthRoute('login')
})

describe('desktop authentication', () => {
  it('submits a normalized email with the selected remember state', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('邮箱'), '  TEST@EXAMPLE.COM ')
    await user.type(screen.getByLabelText('密码'), 'Test1234!')
    await user.click(screen.getByLabelText('保持登录'))
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(mutations.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Test1234!',
        remember: false,
      })
    })
  })

  it('switches the form by updating the authentication hash route', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(screen.getByRole('heading', { name: '创建账号' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/register')
  })

  it('keeps registration local when the form is invalid', async () => {
    const user = userEvent.setup()
    setAuthRoute('register')
    render(<App />)

    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(screen.getByText('请输入正确的邮箱地址')).toBeInTheDocument()
    expect(screen.getByText('请先同意服务条款和隐私政策')).toBeInTheDocument()
    expect(mutations.register).not.toHaveBeenCalled()
  })

  it('keeps password reset local when the form is invalid', async () => {
    const user = userEvent.setup()
    setAuthRoute('forgot')
    render(<App />)

    await user.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getByText('请输入 6 位验证码')).toBeInTheDocument()
    expect(mutations.resetPassword).not.toHaveBeenCalled()
  })
})
