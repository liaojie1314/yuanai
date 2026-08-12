import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopAppearanceService } from './desktop-appearance'

const nativeTheme = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  shouldUseDarkColors: false,
  themeSource: 'system' as 'system' | 'light' | 'dark',
}))

const windowOne = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  setBackgroundColor: vi.fn(),
}))
const windowTwo = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  setBackgroundColor: vi.fn(),
}))
const onChanged = vi.hoisted(() => vi.fn())

function createService(): DesktopAppearanceService {
  return new DesktopAppearanceService({
    nativeTheme,
    getWindows: () => [windowOne, windowTwo],
    onChanged,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  nativeTheme.shouldUseDarkColors = false
  nativeTheme.themeSource = 'system'
  windowOne.isDestroyed.mockReturnValue(false)
  windowTwo.isDestroyed.mockReturnValue(false)
})

describe('DesktopAppearanceService', () => {
  it('maps the shared auto preference to Electron system theme and updates every window', () => {
    const service = createService()

    expect(service.apply('auto')).toEqual({ choice: 'auto', resolved: 'light' })
    expect(nativeTheme.themeSource).toBe('system')
    expect(windowOne.setBackgroundColor).toHaveBeenCalledWith('#f5f7fb')
    expect(windowTwo.setBackgroundColor).toHaveBeenCalledWith('#f5f7fb')
    expect(onChanged).toHaveBeenLastCalledWith({ choice: 'auto', resolved: 'light' })
  })

  it('propagates system changes only while following the system theme', () => {
    const service = createService()
    service.start()
    nativeTheme.shouldUseDarkColors = true
    const listener = nativeTheme.on.mock.calls[0]?.[1]

    listener?.()

    expect(onChanged).toHaveBeenLastCalledWith({ choice: 'auto', resolved: 'dark' })
    expect(windowOne.setBackgroundColor).toHaveBeenLastCalledWith('#111827')
    service.dispose()
    expect(nativeTheme.removeListener).toHaveBeenCalledWith('updated', expect.any(Function))
  })

  it('applies the current native background when a new window is created', () => {
    const service = createService()
    nativeTheme.shouldUseDarkColors = true

    service.applyToWindow(windowOne)

    expect(windowOne.setBackgroundColor).toHaveBeenCalledWith('#111827')
  })
})
