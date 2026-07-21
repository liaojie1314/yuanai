import { Redirect, Slot, useRouter, useSegments } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { useMemo } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'

import { TABLET_MIN_WIDTH, useAuthStore } from '@yuanai/core'

import { ConversationList } from '@/components/main/ConversationList'
import { bg, border } from '@/theme/tokens'

/**
 * 已登录路由分组的自适应布局。
 *
 * - 平板（宽度 ≥ 768pt）：左侧固定 280pt 会话列表 + 右侧内容区
 * - 手机（宽度 < 768pt）：expo-router 的 Drawer navigator；侧边栏由手势 / 顶部按钮打开
 *
 * 关键点：
 * - 未登录直接 Redirect 到 (auth)/login，防止用户在 middleware 之外的入口混进来
 * - 平板双栏用 `<Slot />` 而不是 `<Stack />`：只有一个内容区不需要 stack 语义；
 *   路由跳转靠 activeId + router.push，交给 (main)/chat/[conversationId] 处理
 * - 手机 Drawer 的 drawerContent 是 `<ConversationList onClose={props.navigation.closeDrawer} />`
 */
export default function MainLayout(): React.JSX.Element {
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const accessToken = useAuthStore((s) => s.accessToken)
  const router = useRouter()
  const segments = useSegments()

  // segments 形如 ['(main)', 'chat', '<id>']；取第 3 段作为 activeId。
  // useSegments 返回 readonly string[]，无 tuple 断言时需按索引取字符串。
  const activeId = useMemo<string | undefined>(() => {
    const list = segments as readonly string[]
    if (list[1] === 'chat' && typeof list[2] === 'string') return list[2]
    return undefined
  }, [segments])

  if (!accessToken) return <Redirect href="/(auth)/login" />

  if (isTablet) {
    return (
      <View style={styles.tabletRow}>
        <View style={styles.tabletSidebar}>
          <ConversationList
            activeId={activeId}
            onPickConversation={(id) => {
              router.push(`/(main)/chat/${id}`)
            }}
          />
        </View>
        <View style={styles.tabletContent}>
          <Slot />
        </View>
      </View>
    )
  }

  return (
    <Drawer
      // 显式钉死初始路由与返回行为：Drawer 默认 backBehavior 回「注册顺序第一个
      // 路由」，而文件路由把 settings 排在 chat 前 → 硬件返回从会话页弹到设置页，
      // 再返回一次触发 GO_BACK not handled。
      initialRouteName="chat/index"
      backBehavior="initialRoute"
      drawerContent={(props: { navigation: { closeDrawer: () => void } }) => (
        <DrawerContent
          activeId={activeId}
          onClose={() => {
            props.navigation.closeDrawer()
          }}
        />
      )}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: styles.drawerStyle,
        swipeEnabled: true,
      }}
    />
  )
}

// 拆出来避免 drawerContent 每次渲染都产生新 identity
function DrawerContent({
  activeId,
  onClose,
}: {
  activeId?: string | undefined
  onClose: () => void
}): React.JSX.Element {
  const router = useRouter()
  return (
    <ConversationList
      activeId={activeId}
      onClose={onClose}
      onPickConversation={(id) => {
        onClose()
        router.push(`/(main)/chat/${id}`)
      }}
    />
  )
}

const styles = StyleSheet.create({
  tabletRow: { flex: 1, flexDirection: 'row', backgroundColor: bg.base },
  tabletSidebar: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: border.default,
    backgroundColor: bg.surface,
  },
  tabletContent: { flex: 1 },
  drawerStyle: { width: '82%', backgroundColor: bg.surface },
})
