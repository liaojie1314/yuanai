import { Stack } from 'expo-router'

/**
 * 未登录路由分组。仅承载 login / register / forgot-password / oauth-callback
 * 等公开屏；`headerShown: false` 让每个屏自己控制头部，避免默认导航栏在 iOS 上
 * 与我们的自定义品牌头冲突。
 */
export default function AuthLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />
}
