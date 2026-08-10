import { setApiBaseUrl } from '@yuanai/core/api'
import { setPlatformAdapter } from '@yuanai/core/platform'

import { bootstrapDesktop } from './bootstrap'
import { createDesktopAdapter } from './desktop-adapter'

/** 以统一且无存储竞态的顺序启动任一 Electron renderer。 */
export function startDesktopRenderer(mount: () => void | Promise<void>): void {
  void bootstrapDesktop({
    api: window.yuanai,
    adapter: createDesktopAdapter(window.yuanai),
    setAdapter: setPlatformAdapter,
    setApiUrl: setApiBaseUrl,
    importStores: async () => {
      await import('@yuanai/core/stores')
    },
    mount,
  }).catch((error: unknown) => {
    console.error('Desktop renderer bootstrap failed', error)
  })
}
