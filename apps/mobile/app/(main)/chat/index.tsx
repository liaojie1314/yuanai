import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text, View } from 'react-native'

/**
 * `/chat` 空状态占位。真正的会话列表 / 新建会话引导由 Step 7 承接。
 */
export default function ChatEmptyScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="bg-bg-base items-center justify-center"
    >
      <Text className="text-text-primary text-lg font-semibold">元AI</Text>
      <Text className="text-text-secondary mt-2 text-sm">聊天主界面待实现 (Step 7)</Text>
    </View>
  )
}
