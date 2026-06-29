import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import StrengthBar from '@/components/auth/StrengthBar'

function renderWithI18n(ui: React.ReactElement, locale: 'zh-CN' | 'en' = 'zh-CN') {
  const messages = locale === 'en' ? en : zhCN
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

// Score calculation:
// score 0: none — no display
// score 1: length>=8 only           → 'testtest'
// score 2: length>=8 + uppercase    → 'Testtest'
// score 3: length>=8 + upper + num  → 'Test1234'
// score 4: all four conditions      → 'Test1234!'

describe('StrengthBar', () => {
  it('renders nothing when password is empty', () => {
    const { container } = renderWithI18n(<StrengthBar password="" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows weak label for score-1 password in zh-CN', () => {
    renderWithI18n(<StrengthBar password="testtest" />, 'zh-CN')
    expect(screen.getByText(/弱/)).toBeInTheDocument()
  })

  it('shows weak label for score-1 password in en', () => {
    renderWithI18n(<StrengthBar password="testtest" />, 'en')
    expect(screen.getByText(/Weak/)).toBeInTheDocument()
  })

  it('shows medium label for score-2 password in zh-CN', () => {
    renderWithI18n(<StrengthBar password="Testtest" />, 'zh-CN')
    expect(screen.getByText(/中/)).toBeInTheDocument()
  })

  it('shows medium label for score-2 password in en', () => {
    renderWithI18n(<StrengthBar password="Testtest" />, 'en')
    expect(screen.getByText(/Medium/)).toBeInTheDocument()
  })

  it('shows strong label for score-3 password in zh-CN', () => {
    renderWithI18n(<StrengthBar password="Test1234" />, 'zh-CN')
    expect(screen.getByText(/强/)).toBeInTheDocument()
  })

  it('shows very strong label for score-4 password in zh-CN', () => {
    renderWithI18n(<StrengthBar password="Test1234!" />, 'zh-CN')
    expect(screen.getByText(/很强/)).toBeInTheDocument()
  })

  it('shows very strong label for score-4 password in en', () => {
    renderWithI18n(<StrengthBar password="Test1234!" />, 'en')
    expect(screen.getByText(/Very Strong/)).toBeInTheDocument()
  })

  it('renders 4 bar segments', () => {
    const { container } = renderWithI18n(<StrengthBar password="testtest" />)
    const bars = container.querySelectorAll('.bar')
    expect(bars).toHaveLength(4)
  })

  it('activates correct number of bar segments for score 2', () => {
    const { container } = renderWithI18n(<StrengthBar password="Testtest" />)
    const activeBars = container.querySelectorAll('.bar.s2')
    expect(activeBars).toHaveLength(2)
  })
})
