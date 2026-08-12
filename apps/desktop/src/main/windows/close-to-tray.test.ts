import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_DESKTOP_PREFERENCES } from '../../shared/ipc-contract'
import { installCloseToTrayBehavior } from './close-to-tray'

function createWindow(): {
  close: ReturnType<typeof vi.fn>
  fireClose(): void
  hide: ReturnType<typeof vi.fn>
  preventDefault: ReturnType<typeof vi.fn>
  window: {
    close: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
} {
  let listener: ((event: { preventDefault(): void }) => void) | undefined
  const close = vi.fn()
  const hide = vi.fn()
  const on = vi.fn((_event: string, nextListener: (event: { preventDefault(): void }) => void) => {
    listener = nextListener
  })
  const preventDefault = vi.fn()
  return {
    close,
    fireClose: () => listener?.({ preventDefault }),
    hide,
    preventDefault,
    window: { close, hide, on },
  }
}

describe('installCloseToTrayBehavior', () => {
  it('hides the main window when close-to-tray is enabled', async () => {
    const fixture = createWindow()
    installCloseToTrayBehavior({
      isQuitting: () => false,
      onQuit: vi.fn(),
      preferencesStorage: { get: vi.fn().mockResolvedValue(DEFAULT_DESKTOP_PREFERENCES) },
      window: fixture.window,
    })

    fixture.fireClose()
    await vi.waitFor(() => expect(fixture.hide).toHaveBeenCalledOnce())
    expect(fixture.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.close).not.toHaveBeenCalled()
  })

  it('allows the main window to close when the preference is disabled', async () => {
    const fixture = createWindow()
    const onQuit = vi.fn()
    installCloseToTrayBehavior({
      isQuitting: () => false,
      onQuit,
      preferencesStorage: {
        get: vi.fn().mockResolvedValue({ ...DEFAULT_DESKTOP_PREFERENCES, closeToTray: false }),
      },
      window: fixture.window,
    })

    fixture.fireClose()
    await vi.waitFor(() => expect(onQuit).toHaveBeenCalledOnce())
    expect(fixture.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.close).not.toHaveBeenCalled()
  })

  it('does not block explicit application shutdown', () => {
    const fixture = createWindow()
    const get = vi.fn()
    installCloseToTrayBehavior({
      isQuitting: () => true,
      onQuit: vi.fn(),
      preferencesStorage: { get },
      window: fixture.window,
    })

    fixture.fireClose()
    expect(fixture.preventDefault).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})
