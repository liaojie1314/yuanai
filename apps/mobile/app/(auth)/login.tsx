import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text, View } from 'react-native'

/**
 * 登录页脚手架占位。
 *
 * Phase 3 Step 5 UI 阶段会替换为完整的邮箱/密码 + Google 原生 + GitHub 深链接
 * 三种登录路径实现；当前先保证路由骨架能编过、Splash 隐藏后有内容可见，
 * 便于 Step 3 阶段验证 SafeArea 是否生效。
 */
export default function LoginScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      className="bg-bg-base"
    >
      <Text className="text-text-primary text-lg font-semibold">元AI · 登录页</Text>
      <Text className="text-text-secondary mt-2 text-sm">Phase 3 Step 5 待实现</Text>
    </View>
  )
}
