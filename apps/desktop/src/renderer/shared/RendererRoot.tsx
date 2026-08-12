import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'

import { synchronizeDesktopAuthState } from './auth-client'
import { AppearanceProvider } from './AppearanceProvider'
import { DesktopTitlebar } from './DesktopTitlebar'
import { DesktopI18nProvider } from './i18n'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

/** 为每个 Electron renderer 提供共享的服务端状态缓存。 */
export function RendererRoot({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => {
    document.documentElement.dataset.desktopPlatform = window.yuanai.platform
    return () => {
      delete document.documentElement.dataset.desktopPlatform
    }
  }, [])

  useEffect(() => {
    return window.yuanai.events.onAuthChanged((hasSession) => {
      if (!hasSession) return
      void synchronizeDesktopAuthState()
    })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <DesktopI18nProvider>
        <AppearanceProvider>
          <DesktopTitlebar>{children}</DesktopTitlebar>
        </AppearanceProvider>
      </DesktopI18nProvider>
    </QueryClientProvider>
  )
}
