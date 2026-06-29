import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import AuthPanel from '@/components/auth/AuthPanel'

vi.mock('@/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual }
})

function renderWithI18n(ui: React.ReactElement, locale: 'zh-CN' | 'en' = 'zh-CN') {
  const messages = locale === 'en' ? en : zhCN
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('AuthPanel', () => {
  const bubbles: [string] = ['Test bubble']

  it('renders app name from translations in zh-CN', () => {
    renderWithI18n(<AuthPanel bubbles={bubbles} />, 'zh-CN')
    expect(screen.getByText('元AI')).toBeInTheDocument()
  })

  it('renders app name from translations in en', () => {
    renderWithI18n(<AuthPanel bubbles={bubbles} />, 'en')
    expect(screen.getByText('YuanAI')).toBeInTheDocument()
  })

  it('renders tagline in zh-CN', () => {
    renderWithI18n(<AuthPanel bubbles={bubbles} />, 'zh-CN')
    expect(screen.getByText('你的智能对话伙伴')).toBeInTheDocument()
  })

  it('renders tagline in en', () => {
    renderWithI18n(<AuthPanel bubbles={bubbles} />, 'en')
    expect(screen.getByText('Your Intelligent Conversation Partner')).toBeInTheDocument()
  })

  it('renders bubble text', () => {
    renderWithI18n(<AuthPanel bubbles={['Hello bubble']} />, 'zh-CN')
    expect(screen.getByText('Hello bubble')).toBeInTheDocument()
  })

  it('renders theme toggle button with accessible label', () => {
    renderWithI18n(<AuthPanel bubbles={bubbles} />, 'zh-CN')
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label')
    const label = button.getAttribute('aria-label') ?? ''
    expect(label.length).toBeGreaterThan(0)
  })
})
