import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import SettingsModal from '@/components/settings/SettingsModal'

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

vi.mock('@yuanai/core/hooks', () => ({
  useCurrentUser: () => ({
    data: { username: 'testuser', email: 'test@example.com' },
  }),
  useMyStats: () => ({
    data: { conversationCount: 5, totalTokens: 1500, fileCount: 2 },
  }),
  useUpdateMe: () => ({ mutate: mockUpdateMeMutate }),
  useChangePassword: () => ({ mutate: mockChangePasswordMutate }),
  useDeleteMe: () => ({ mutate: mockDeleteMeMutate }),
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
    // te**@example.com — first 2 chars + ** + domain
    expect(screen.getAllByText('te**@example.com').length).toBeGreaterThan(0)
  })

  it('shows stats from useMyStats: conversationCount, totalTokens (formatted), fileCount', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getByText('5')).toBeInTheDocument() // conversationCount
    expect(screen.getByText('1.5k')).toBeInTheDocument() // 1500 → 1.5k
    expect(screen.getByText('2')).toBeInTheDocument() // fileCount
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

  it('zh-CN is selected by default in language section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '语言与地区')
    expect(screen.getByRole('radio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')
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

  it('applies dark theme and shows success toast on theme card click', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    await user.click(screen.getByText('深色'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await waitFor(() => {
      expect(screen.getAllByText('成功').length).toBeGreaterThan(0)
    })
  })

  it('density buttons work in appearance section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '外观与主题')
    const compactBtn = screen.getByRole('button', { name: '紧凑' })
    await user.click(compactBtn)
    expect(compactBtn).toHaveClass('sel')
  })

  // ── Notifications section ────────────────────────────
  it('renders notification toggles in notifications section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '通知设置')
    const toggles = screen.getAllByRole('switch')
    expect(toggles.length).toBeGreaterThan(0)
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

  it('shows error toast when new passwords do not match', async () => {
    const user = userEvent.setup()
    const { container } = renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    const [oldInput, newInput, confInput] = Array.from(
      container.querySelectorAll('input.st-field-inp.pw')
    ) as [HTMLInputElement, HTMLInputElement, HTMLInputElement]
    await user.type(oldInput, 'OldPass1!')
    await user.type(newInput, 'NewPass99!')
    await user.type(confInput, 'DifferentPw9!')
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

  it('shows success toast after successful password change', async () => {
    mockChangePasswordMutate.mockImplementation(
      (_data: unknown, opts: { onSuccess?: () => void }) => {
        opts?.onSuccess?.()
      }
    )
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
    await waitFor(() => {
      expect(screen.getAllByText('密码已修改').length).toBeGreaterThan(0)
    })
    // Sub-modal should close after success
    expect(screen.queryByText('修改密码', { selector: '.st-sub-title' })).not.toBeInTheDocument()
  })

  it('shows API error message when changePassword fails', async () => {
    mockChangePasswordMutate.mockImplementation(
      (_data: unknown, opts: { onError?: (err: unknown) => void }) => {
        opts?.onError?.({
          response: { data: { detail: { message: '当前密码不正确' } } },
        })
      }
    )
    const user = userEvent.setup()
    const { container } = renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '修改密码' }))
    const [oldInput, newInput, confInput] = Array.from(
      container.querySelectorAll('input.st-field-inp.pw')
    ) as [HTMLInputElement, HTMLInputElement, HTMLInputElement]
    await user.type(oldInput, 'WrongOld1!')
    await user.type(newInput, 'NewPass99!')
    await user.type(confInput, 'NewPass99!')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(screen.getAllByText('当前密码不正确').length).toBeGreaterThan(0)
    })
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
    // Typing wrong text still disabled
    await user.type(screen.getByPlaceholderText('请输入"删除账号"'), '错误文本')
    expect(confirmBtn).toBeDisabled()
  })

  it('confirm button becomes enabled when exact text is typed', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    await navigateTo(user, '账号安全')
    await user.click(screen.getByRole('button', { name: '注销账号' }))
    await user.type(screen.getByPlaceholderText('请输入"删除账号"'), '删除账号')
    expect(screen.getByRole('button', { name: '确认' })).not.toBeDisabled()
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
})
