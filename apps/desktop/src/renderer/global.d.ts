import type { YuanaiApi } from '../preload'

declare global {
  interface Window {
    /** sandbox preload 暴露的受限桌面能力。 */
    yuanai: YuanaiApi
  }
}

export {}
