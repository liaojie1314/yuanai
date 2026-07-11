import * as Sentry from '@sentry/react-native'

/**
 * 初始化 Sentry。DSN 未配置时静默跳过（本地开发常态），避免污染日志。
 *
 * `enableAutoSessionTracking` 让 Sentry 在应用启停时统计崩溃自由率；
 * `tracesSampleRate` 采样 20% 请求 / 渲染性能，正式量放大前先小样本观察。
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.2,
    // release 与 dist 由 EAS Build 注入 (SENTRY_RELEASE / SENTRY_DIST)
  })
}

/**
 * 让根组件用 `Sentry.wrap(...)` 包装以启用错误边界 / Profiler。
 * 未配置 DSN 时降级为 identity（Sentry 未 init 会警告 "App Start Span could not be finished"）。
 */
export const wrapWithSentry: typeof Sentry.wrap = process.env.EXPO_PUBLIC_SENTRY_DSN
  ? Sentry.wrap
  : (Component) => Component
