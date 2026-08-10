import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LanguageSection } from './LanguageSection'

afterEach(() => {
  cleanup()
})

describe('LanguageSection', () => {
  it('persists a language selection without reloading the desktop window', async () => {
    const user = userEvent.setup()
    const onPreferencesChanged = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    render(
      <LanguageSection
        preferences={{
          theme: 'auto',
          fontSize: 'medium',
          density: 'standard',
          timeFormat: '24h',
          dateFormat: 'ymd',
          language: 'zh-CN',
        }}
        onPreferencesChanged={onPreferencesChanged}
      />
    )

    await user.click(screen.getByRole('radio', { name: 'English' }))

    expect(onPreferencesChanged).toHaveBeenCalledWith({ language: 'en' })
  })
})
