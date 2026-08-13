import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhCN from '@/i18n/locales/zh-CN.json'
import { Toaster } from '@/components/Toaster'
import { useToastStore } from '@/hooks/useToast'
import RegisterPage from './page'

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  sendVerifyCode: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useRegister: () => ({ isPending: false, mutateAsync: mocks.register }),
  useSendVerifyCode: () => ({ isPending: false, mutateAsync: mocks.sendVerifyCode }),
}))

function renderRegister(): void {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
      <RegisterPage />
      <Toaster />
    </NextIntlClientProvider>
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
  })

  it('在右上角 Toast 显示发送验证码的请求失败，不占用表单空间', async () => {
    mocks.sendVerifyCode.mockRejectedValueOnce(new Error('network unavailable'))
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'toast@example.test')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('验证码发送失败，请稍后再试')
    })
    expect(screen.queryByText('验证码发送失败，请稍后再试', { selector: '.ferr' })).toBeNull()
  })
})
