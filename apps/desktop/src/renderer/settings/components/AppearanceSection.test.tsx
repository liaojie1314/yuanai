import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppearanceSection } from './AppearanceSection'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

describe('AppearanceSection', () => {
  it('applies and persists the selected theme immediately', async () => {
    const user = userEvent.setup()
    const onPreferencesChanged = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    render(
      <AppearanceSection
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

    await user.click(screen.getByRole('radio', { name: '深色' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(onPreferencesChanged).toHaveBeenCalledWith({ theme: 'dark' })
  })
})
