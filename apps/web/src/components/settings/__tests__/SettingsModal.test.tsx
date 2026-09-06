import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import SettingsModal from '@/components/settings/SettingsModal'
import { APP_VERSION } from '@/lib/app-version'

// ── Module mocks ─────────────────────────────────────
vi.mock('@/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getLocaleFromCookie: vi.fn(() => 'zh-CN'),
    setLocaleCookie: vi.fn(),
  }
})

// Controllable mutate spies — reset in beforeEach
const mockUpdateMeMutate = vi.fn()
const mockChangePasswordMutate = vi.fn()
const mockDeleteMeMutate = vi.fn()
const mockChangeEmailMutate = vi.fn()
const mockSendVerifyCodeMutate = vi.fn()
const mockClearConvsMutate = vi.fn()
const mockUpdatePrefsMutate = vi.fn()

vi.mock('@yuanai/core/hooks', () => ({
  useCurrentUser: () => ({
    data: { username: 'testuser', email: 'test@example.com', bio: null },
  }),
  useMyStats: () => ({
    data: { conversationCount: 5, totalTokens: 1500, fileCount: 2 },
  }),
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
  useUpdateMyPreferences: () => ({ mutate: mockUpdatePrefsMutate }),
  useUpdateMe: () => ({ mutate: mockUpdateMeMutate }),
  useChangePassword: () => ({ mutate: mockChangePasswordMutate, isPending: false }),
  useChangeEmail: () => ({ mutate: mockChangeEmailMutate, isPending: false }),
  useSendVerifyCode: () => ({ mutate: mockSendVerifyCodeMutate, isPending: false }),
  useClearAllConversations: () => ({ mutate: mockClearConvsMutate, isPending: false }),
  useDeleteMe: () => ({ mutate: mockDeleteMeMutate, isPending: false }),
  useUploadAvatar: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkGithub: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkGoogle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

// SettingsModal 引入了 @/lib/push（notif 开关联动 Web Push 订阅）；
// 该模块依赖浏览器 SW/PushManager，测试环境下 mock 成 no-op 即可
vi.mock('@/lib/push', () => ({
  ensurePushSubscribed: vi.fn(),
  removePushSubscription: vi.fn(),
}))

const mockReload = vi.fn()
let hrefStore = ''
Object.defineProperty(window, 'location', {
  value: {
    reload: mockReload,
    get href() {
      return hrefStore
    },
    set href(v: string) {
      hrefStore = v
    },
  },
  writable: true,
})

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    clear: () => {
      store = {}
    },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// ── Helpers ──────────────────────────────────────────
function renderWithI18n(ui: React.ReactElement, locale: 'zh-CN' | 'en' = 'zh-CN') {
  const messages = locale === 'en' ? en : zhCN
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

/** Click the first nav button matching `label` (not sub-modal titles) */
async function navigateTo(user: ReturnType<typeof userEvent.setup>, label: string) {
  const navBtns = screen.getAllByRole('button', { name: label })
  const navBtn = navBtns[0]
  if (!navBtn) throw new Error(`Nav button "${label}" not found`)
  await user.click(navBtn)
}

// ── Test suite ────────────────────────────────────────
describe('SettingsModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    hrefStore = ''
  })

  // ── Visibility ──────────────────────────────────────
  it('does not render when open=false', () => {
    renderWithI18n(<SettingsModal open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when open=true', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // ── i18n ────────────────────────────────────────────
  it('renders Settings title in zh-CN', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    expect(screen.getAllByText('设置').length).toBeGreaterThan(0)
  })

  it('renders Settings title in en', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'en')
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
  })

  // ── Keyboard ─────────────────────────────────────────
  it('calls onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  // ── Navigation ───────────────────────────────────────
  it('renders nav items for all sections in zh-CN', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    expect(screen.getByRole('button', { name: '个人资料' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '账号安全' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '外观与主题' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通知设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '语言与地区' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关于与帮助' })).toBeInTheDocument()
  })

  it('renders nav items in en', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'en')
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Language & Region' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About & Help' })).toBeInTheDocument()
  })

  // ── Profile section (real API data) ─────────────────
  it('shows username from useCurrentUser in profile section', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getAllByText('testuser').length).toBeGreaterThan(0)
  })

  it('shows masked email from useCurrentUser', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getAllByText('te**@example.com').length).toBeGreaterThan(0)
  })

  it('shows stats from useMyStats', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('1.5k')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // ── Language section ─────────────────────────────────
  it('navigates to language section and shows language radiogroup', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '语言与地区')
    expect(screen.getByRole('radiogroup', { name: '界面语言' })).toBeInTheDocument()
  })

  it('shows all supported language options', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '语言与地区')
    expect(screen.getByRole('radio', { name: '简体中文' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument()
  })

  it('switches language: sets cookie and reloads page', async () => {
    const { setLocaleCookie } = await import('@/i18n/client')
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '语言与地区')
    await user.click(screen.getByRole('radio', { name: 'English' }))
    expect(setLocaleCookie).toHaveBeenCalledWith('en')
    expect(mockReload).toHaveBeenCalled()
  })

  // ── Appearance section ───────────────────────────────
  it('navigates to appearance and shows theme cards', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    expect(screen.getByText('跟随系统')).toBeInTheDocument()
    expect(screen.getByText('浅色')).toBeInTheDocument()
    expect(screen.getByText('深色')).toBeInTheDocument()
  })

  it('applies dark theme on card click', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    await user.click(screen.getByText('深色'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('density buttons work in appearance section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    const compactBtn = screen.getByRole('button', { name: '紧凑' })
    await user.click(compactBtn)
    expect(compactBtn).toHaveClass('sel')
  })

  it('persists preference to backend when logged in', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    await user.click(screen.getByText('深色'))
    expect(mockUpdatePrefsMutate).toHaveBeenCalledWith({ theme: 'dark' })
  })

  // ── Security — sub-modal open/close ──────────────────
  it('opens change email sub-modal from security section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByText('更换邮箱'))
    expect(screen.getByText('更换邮箱', { selector: '.st-sub-title' })).toBeInTheDocument()
  })

  it('closes sub-modal with ESC, keeps main modal open', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    await navigateTo(user, '账号安全')
    await user.click(screen.getByText('更换邮箱'))
    expect(screen.getByText('更换邮箱', { selector: '.st-sub-title' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('更换邮箱', { selector: '.st-sub-title' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows delete confirmation text in en', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'en')
    await navigateTo(user, 'Security')
    await user.click(screen.getByRole('button', { name: 'Delete Account' }))
    expect(screen.getByText('Delete Account', { selector: '.st-sub-title' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/delete account/i)).toBeInTheDocument()
  })

  // ── Change email ────────────────────────────────────
  it('sends verify code with change_email scene', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByText('更换邮箱'))
    await user.type(screen.getByPlaceholderText('your@email.com'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(mockSendVerifyCodeMutate).toHaveBeenCalledWith(
      { email: 'new@example.com', scene: 'change_email' },
      expect.any(Object)
    )
  })

  it('calls changeEmail mutate on submit', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByText('更换邮箱'))
    await user.type(screen.getByPlaceholderText('your@email.com'), 'new@example.com')
    const codeInputs = screen.getAllByRole('textbox')
    const codeInput = codeInputs[codeInputs.length - 1]
    if (!codeInput) throw new Error('code input not found')
    await user.type(codeInput, '888888')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(mockChangeEmailMutate).toHaveBeenCalledWith(
      { newEmail: 'new@example.com', verifyCode: '888888' },
      expect.any(Object)
    )
  })

  // ── Change password ──────────────────────────────────
  it('opens change password sub-modal from security section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    expect(screen.getByText('修改密码', { selector: '.st-sub-title' })).toBeInTheDocument()
  })

  it('shows error toast when change password fields are empty', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(screen.getAllByText('错误').length).toBeGreaterThan(0)
    })
    expect(mockChangePasswordMutate).not.toHaveBeenCalled()
  })

  it('calls changePasswordMutate with correct args when fields are valid', async () => {
    const user = userEvent.setup()
    const { container } = renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    const [oldInput, newInput, confInput] = Array.from(
      container.querySelectorAll('input.st-field-inp.pw')
    ) as [HTMLInputElement, HTMLInputElement, HTMLInputElement]
    await user.type(oldInput, 'OldPass1!')
    await user.type(newInput, 'NewPass99!')
    await user.type(confInput, 'NewPass99!')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(mockChangePasswordMutate).toHaveBeenCalledWith(
      { oldPassword: 'OldPass1!', newPassword: 'NewPass99!' },
      expect.any(Object)
    )
  })

  // ── Delete account ───────────────────────────────────
  it('opens delete account sub-modal from security section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    expect(screen.getByText('注销账号', { selector: '.st-sub-title' })).toBeInTheDocument()
  })

  it('confirm button is disabled until exact text is typed', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    const confirmBtn = screen.getByRole('button', { name: '确认' })
    expect(confirmBtn).toBeDisabled()
    await user.type(screen.getByPlaceholderText('请输入"删除账号"'), '错误文本')
    expect(confirmBtn).toBeDisabled()
  })

  it('calls deleteMe mutate when confirmation text is correct', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    await user.type(screen.getByPlaceholderText('请输入"删除账号"'), '删除账号')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(mockDeleteMeMutate).toHaveBeenCalledWith(undefined, expect.any(Object))
  })

  it('redirects to /login after successful account deletion', async () => {
    mockDeleteMeMutate.mockImplementation((_: undefined, opts: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    })
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    await user.type(screen.getByPlaceholderText('请输入"删除账号"'), '删除账号')
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
      expect(hrefStore).toBe('/login')
    })
  })

  // ── Clear conversations（危险操作在 security section） ─────
  it('opens clear conversations sub-modal from security section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: /清空全部/ }))
    expect(screen.getByText('清空所有会话', { selector: '.st-sub-title' })).toBeInTheDocument()
  })

  it('calls clearAllConversations mutate on confirm', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: /清空全部/ }))
    await user.click(screen.getByRole('button', { name: '清空' }))
    expect(mockClearConvsMutate).toHaveBeenCalledWith(undefined, expect.any(Object))
  })

  // ── About & Notifications sections ───────────────────
  it('renders notifications section with toggles', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '通知设置')
    const toggles = screen.getAllByRole('switch')
    expect(toggles.length).toBeGreaterThan(0)
  })

  it('renders about section with app name', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '关于与帮助')
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument()
  })
})
