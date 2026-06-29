import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import SettingsModal from '@/components/settings/SettingsModal'

vi.mock('@/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getLocaleFromCookie: vi.fn(() => 'zh-CN'),
    setLocaleCookie: vi.fn(),
  }
})

const mockReload = vi.fn()
Object.defineProperty(window, 'location', {
  value: { reload: mockReload },
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

function renderWithI18n(ui: React.ReactElement, locale: 'zh-CN' | 'en' = 'zh-CN') {
  const messages = locale === 'en' ? en : zhCN
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

// Navigate to a section by clicking its nav button (nav item, not section header)
async function navigateTo(user: ReturnType<typeof userEvent.setup>, label: string) {
  const navBtns = screen.getAllByRole('button', { name: label })
  const navBtn = navBtns[0]
  if (!navBtn) throw new Error(`Nav button "${label}" not found`)
  await user.click(navBtn)
}

describe('SettingsModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  it('does not render when open=false', () => {
    renderWithI18n(<SettingsModal open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when open=true', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders Settings title in zh-CN', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    expect(screen.getAllByText('设置').length).toBeGreaterThan(0)
  })

  it('renders Settings title in en', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'en')
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
  })

  it('calls onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nav items for all sections in zh-CN', () => {
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')
    // Nav items are buttons; use getByRole with exact names
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

  it('switches language: sets cookie and reloads', async () => {
    const { setLocaleCookie } = await import('@/i18n/client')
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')

    await navigateTo(user, '语言与地区')
    await user.click(screen.getByRole('radio', { name: 'English' }))

    expect(setLocaleCookie).toHaveBeenCalledWith('en')
    expect(mockReload).toHaveBeenCalled()
  })

  it('navigates to appearance and shows theme cards', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')

    await navigateTo(user, '外观与主题')
    expect(screen.getByText('跟随系统')).toBeInTheDocument()
    expect(screen.getByText('浅色')).toBeInTheDocument()
    expect(screen.getByText('深色')).toBeInTheDocument()
  })

  it('applies dark theme and shows toast on theme card click', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')

    await navigateTo(user, '外观与主题')
    await user.click(screen.getByText('深色'))

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await waitFor(() => {
      // toast shows common.success
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

  it('renders notification toggles in notifications section', async () => {
    const user = userEvent.setup()
    renderWithI18n(<SettingsModal open={true} onClose={onClose} />, 'zh-CN')

    await navigateTo(user, '通知设置')
    const toggles = screen.getAllByRole('switch')
    expect(toggles.length).toBeGreaterThan(0)
  })

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

    // Sub-modal is open
    expect(screen.getByText('更换邮箱', { selector: '.st-sub-title' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    // Sub-modal closed, main modal still open
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
})
