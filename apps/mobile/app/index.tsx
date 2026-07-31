import { Redirect } from 'expo-router'

import { useAuthStore } from '@yuanai/core'

/**
 * 冷启动落地页。
 *
 * `_layout` 在 `authReady=false` 时不渲染 `<Stack />`，所以这里被评估时
 * auth store 已完成 rehydrate，可以放心根据 accessToken 是否存在做分流。
 * 未登录 → `(auth)/login`；已登录 → `(main)/chat`。
 */
export default function IndexScreen(): React.JSX.Element {
  const accessToken = useAuthStore((s) => s.accessToken)
  if (accessToken) {
    return <Redirect href="/(main)/chat" />
  }
  return <Redirect href="/(auth)/login" />
}
