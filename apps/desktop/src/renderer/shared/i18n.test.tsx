import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { changeDesktopLanguage, DesktopI18nProvider, desktopI18n } from './i18n'
import { useTranslation } from 'react-i18next'

function TranslatedContent(): React.JSX.Element {
  const { t } = useTranslation()
  return <span>{t('settings.sections.language')}</span>
}

afterEach(async () => {
  await changeDesktopLanguage('zh-CN')
})

describe('desktop i18n', () => {
  it('reuses Web resources and changes renderer language immediately', async () => {
    render(
      <DesktopI18nProvider>
        <TranslatedContent />
      </DesktopI18nProvider>
    )

    expect(screen.getByText('语言与地区')).toBeInTheDocument()

    await changeDesktopLanguage('en')

    await waitFor(() => expect(screen.getByText('Language & Region')).toBeInTheDocument())
    expect(desktopI18n.t('chat.sidebar.login')).toBe('Log In')
  })

  it('falls back safely to Chinese for a language unsupported by the desktop app', async () => {
    await changeDesktopLanguage('fr')

    expect(desktopI18n.language).toBe('zh-CN')
    expect(desktopI18n.t('desktop.settings.desktop')).toBe('桌面设置')
  })
})
