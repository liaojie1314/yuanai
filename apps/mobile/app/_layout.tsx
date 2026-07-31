import 'react-native-gesture-handler'
import '../global.css'

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { setPlatformAdapter, useAuthStore, usePrefsStore } from '@yuanai/core'

import { ThemeShell } from '@/components/ThemeShell'
import { DialogProvider } from '@/components/ui/Dialog'
import { ToastProvider } from '@/components/ui/Toast'
import { useAppStateStream } from '@/hooks/useAppStateStream'
import { useHydrateAuth } from '@/hooks/useHydrateAuth'
import { useLinkingHandler } from '@/hooks/useLinkingHandler'
import { I18nProvider } from '@/i18n/provider'
import { initApiClientBridge } from '@/lib/apiClientSetup'
import { mobileAdapter } from '@/lib/mobileAdapter'
import { initSentry, wrapWithSentry } from '@/lib/sentry'

// ─── 顶层同步初始化 ─────────────────────────────────────────────
// 顺序敏感：
// 1. Splash 阻塞：等 auth hydrate 完成再手动 hide，避免"未登录 → 已登录"闪
// 2. 平台适配器：必须早于任何 packages/core 里的 hook / store 读取
// 3. Sentry：错误上报越早越好；未配 DSN 时 no-op
// 4. apiClient bridge：向 axios 拦截器注入 token getter
SplashScreen.preventAutoHideAsync().catch(() => {
  /* Splash 已被关掉时静默 */
})
setPlatformAdapter(mobileAdapter)
// store 模块加载时 persist 已用 Web 默认 adapter 触发过一次 rehydrate（RN 上
// 读到 null），必须在换成 mobileAdapter 后重放，token 才能从 SecureStore 恢复。
void useAuthStore.persist.rehydrate()
void usePrefsStore.persist.rehydrate()
initSentry()
initApiClientBridge()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
})

function RootLayoutContent(): React.JSX.Element | null {
  const authReady = useHydrateAuth()
  useLinkingHandler()
  useAppStateStream()

  useEffect(() => {
    if (authReady) {
      SplashScreen.hideAsync().catch(() => undefined)
    }
  }, [authReady])

  if (!authReady) return null

  return <Stack screenOptions={{ headerShown: false }} />
}

// `react-native-gesture-handler@2.20` 的 props 类型漏声明 children——
// 组件运行时接受 children，但 TS types 里缺 React.PropsWithChildren。
// 断言为一个允许 children 的宽松类型规避该库上游缺陷。
const RootView = GestureHandlerRootView as React.ComponentType<
  React.PropsWithChildren<{ style?: { flex: number } }>
>

function RootLayout(): React.JSX.Element {
  return (
    <RootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <QueryClientProvider client={queryClient}>
            <BottomSheetModalProvider>
              <I18nProvider>
                <ThemeShell>
                  <DialogProvider>
                    <ToastProvider>
                      <RootLayoutContent />
                    </ToastProvider>
                  </DialogProvider>
                </ThemeShell>
              </I18nProvider>
            </BottomSheetModalProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </RootView>
  )
}

export default wrapWithSentry(RootLayout)
