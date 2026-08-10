import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mutations = vi.hoisted(() => ({
  login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  register: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  resetPassword: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendVerifyCode: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

const authWindows = vi.hoisted(() => ({
  openLogin: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  openRegister: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  openForgot: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: { window: authWindows },
  })
})

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

  it('opens registration in a dedicated window without replacing the login form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(authWindows.openRegister).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: '登录元AI' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/login')
  })

  it('opens password recovery in a dedicated window', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '忘记密码？' }))

    expect(authWindows.openForgot).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: '登录元AI' })).toBeInTheDocument()
  })

  it('uses the mobile-inspired centered form shell without a brand sidebar', () => {
    render(<App />)

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByText('专注于你的每一次思考')).not.toBeInTheDocument()
  })

  it('places the verification action inside the verification input row', () => {
    setAuthRoute('register')
    render(<App />)

    const verificationInput = screen.getByLabelText('邮箱验证码')
    const codeButton = screen.getByRole('button', { name: '发送验证码' })

    expect(codeButton.closest('.desktop-auth__input-wrap')).toBe(verificationInput.parentElement)
  })

  it('reserves every registration validation slot before errors are shown', async () => {
    const user = userEvent.setup()
    setAuthRoute('register')
    render(<App />)

    expect(document.querySelectorAll('.desktop-auth__field-error')).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: '创建账号' }))

    expect(document.querySelectorAll('.desktop-auth__field-error')).toHaveLength(6)
    expect(screen.getByText('请先同意服务条款和隐私政策')).toBeInTheDocument()
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
