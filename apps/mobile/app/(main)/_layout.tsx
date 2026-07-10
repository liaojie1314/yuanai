import { Stack } from 'expo-router'

/**
 * 已登录路由分组。Step 6 会把这里替换为「平板双栏 / 手机 Drawer」的自适应布局；
 * 当前阶段保留 Stack 结构，等 ConversationList / chat 屏落地后再切换。
 */
export default function MainLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />
}
