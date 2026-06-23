# Phase 3 — 移动端开发（Expo + React Native）

**前置条件**: Phase 0 完成（Monorepo），Phase 1 完成（后端），Phase 2 完成（packages/core 已有 stores/hooks）  
**分支**: `feat/phase-3-mobile`  
**执行范围**: `apps/mobile/`，可复用 `packages/core` 的所有 stores 和 hooks

---

## 目标

基于 Web 端的业务逻辑（packages/core），实现原生移动端体验：

1. 认证流程（注册/登录）
2. 原生导航（Expo Router）
3. 会话列表 + 聊天界面
4. 流式消息渲染
5. Markdown + 代码高亮
6. 图片/文件上传（原生 Picker）
7. 键盘安全区域适配
8. 平板端双栏布局
9. 系统明暗主题自动切换

---

## 技术选型

| 需求       | 方案                               |
| ---------- | ---------------------------------- |
| 导航       | Expo Router v4（文件系统路由）     |
| 样式       | NativeWind v4（Tailwind for RN）   |
| Markdown   | `react-native-markdown-display`    |
| 代码高亮   | `react-native-syntax-highlighter`  |
| 虚拟列表   | `FlashList`（@shopify/flash-list） |
| 图片选择   | `expo-image-picker`                |
| 文件选择   | `expo-document-picker`             |
| 安全存储   | `expo-secure-store`（token 存储）  |
| 图片显示   | `expo-image`                       |
| 底部安全区 | `react-native-safe-area-context`   |
| 键盘处理   | `react-native-keyboard-controller` |
| Haptic     | `expo-haptics`                     |

---

## Step 1：安装依赖

```bash
cd apps/mobile

# Expo 工具
npx expo install expo-router expo-secure-store expo-image-picker \
  expo-document-picker expo-image expo-haptics \
  react-native-safe-area-context react-native-screens \
  react-native-gesture-handler react-native-reanimated \
  react-native-keyboard-controller

# UI
npx expo install nativewind tailwindcss

# 列表
npx expo install @shopify/flash-list

# Markdown
pnpm add react-native-markdown-display react-native-syntax-highlighter

# 共享包
pnpm add @yuanai/types@workspace:* @yuanai/core@workspace:*

# 状态
pnpm add @tanstack/react-query zustand
```

---

## Step 2：项目配置

### `apps/mobile/app.json` 关键配置

```json
{
  "expo": {
    "name": "元AI",
    "slug": "yuanai",
    "scheme": "yuanai",
    "version": "1.0.0",
    "orientation": "default",
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-image-picker", { "photosPermission": "应用需要访问你的相册以上传图片" }]
    ],
    "android": {
      "package": "com.yuanai.app",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#6366F1"
      }
    },
    "ios": {
      "bundleIdentifier": "com.yuanai.app",
      "supportsTablet": true
    }
  }
}
```

### `apps/mobile/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: { from: '#6366F1', to: '#8B5CF6', solid: '#7C3AED', light: '#EDE9FE' },
        bg: { base: '#FAFAF8', surface: '#FFFFFF', elevated: '#F4F4F2' },
        text: { primary: '#1A1A2E', secondary: '#6B7280', muted: '#9CA3AF' },
        border: { default: '#E5E7EB', focus: '#6366F1' },
      },
      borderRadius: {
        chat: '18px',
      },
    },
  },
}
```

### `apps/mobile/babel.config.js`

```js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  }
}
```

---

## Step 3：路由结构（Expo Router）

```
apps/mobile/app/
├── _layout.tsx                 ← 根布局（Provider、认证守卫）
├── (auth)/
│   ├── _layout.tsx
│   ├── login.tsx
│   └── register.tsx
└── (main)/
    ├── _layout.tsx             ← 平板/手机布局切换
    ├── index.tsx               ← 空状态（重定向/新建对话引导）
    └── chat/
        └── [conversationId].tsx
```

### `apps/mobile/app/_layout.tsx`

```tsx
import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@yuanai/core/stores'
import { setTokenGetter } from '@yuanai/core/api'
import * as SecureStore from 'expo-secure-store'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

export default function RootLayout() {
  const { accessToken, setToken } = useAuthStore()

  useEffect(() => {
    // 从 SecureStore 恢复 token
    void SecureStore.getItemAsync('access_token').then((t) => {
      if (t) setToken(t)
    })
    // 注入 token getter 到 apiClient
    setTokenGetter(() => accessToken)
  }, [accessToken, setToken])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <Stack screenOptions={{ headerShown: false }} />
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
```

---

## Step 4：认证页面

### `apps/mobile/app/(auth)/login.tsx`

```tsx
import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { apiClient } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

export default function LoginScreen() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) return
    setLoading(true)
    try {
      const res = await apiClient.post('/auth/login', { email, password })
      await SecureStore.setItemAsync('access_token', res.data.access_token)
      await SecureStore.setItemAsync('refresh_token', res.data.refresh_token)
      setAuth(res.data.user, res.data.access_token)
      router.replace('/(main)/')
    } catch {
      Alert.alert('登录失败', '邮箱或密码错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {/* Logo */}
      <View style={styles.logo}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>元</Text>
        </View>
        <Text style={styles.title}>欢迎回来</Text>
        <Text style={styles.subtitle}>登录你的 yuanai 账号</Text>
      </View>

      {/* 表单 */}
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="邮箱"
          placeholderTextColor="#9CA3AF"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="密码"
          placeholderTextColor="#9CA3AF"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{loading ? '登录中...' : '登录'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
        <Text style={styles.link}>
          没有账号？<Text style={styles.linkHighlight}>立即注册</Text>
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8', justifyContent: 'center', padding: 24 },
  logo: { alignItems: 'center', marginBottom: 40 },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '600', color: '#1A1A2E', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6B7280' },
  form: { gap: 12, marginBottom: 24 },
  input: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    color: '#1A1A2E',
    fontSize: 15,
  },
  button: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  link: { textAlign: 'center', color: '#6B7280', fontSize: 14 },
  linkHighlight: { color: '#6366F1' },
})
```

---

## Step 5：主聊天界面

### 平板/手机布局切换 `apps/mobile/app/(main)/_layout.tsx`

```tsx
import { useWindowDimensions } from 'react-native'
import { Drawer } from 'expo-router/drawer'
import { Stack } from 'expo-router'
import { ConversationList } from '@/components/ConversationList'

export default function MainLayout() {
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  if (isTablet) {
    // 平板：固定左侧会话列表 + 右侧内容
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 280, borderRightWidth: 1, borderColor: '#E5E7EB' }}>
          <ConversationList />
        </View>
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      </View>
    )
  }

  // 手机：抽屉导航
  return (
    <Drawer
      drawerContent={() => <ConversationList />}
      screenOptions={{ drawerType: 'slide', headerShown: false, drawerStyle: { width: '80%' } }}
    />
  )
}
```

### 聊天页 `apps/mobile/app/(main)/chat/[conversationId].tsx`

```tsx
import { useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlashList } from '@shopify/flash-list'
import { useChatStore } from '@yuanai/core/stores'
import { useStream } from '@yuanai/core/hooks'
import { apiClient } from '@yuanai/core/api'
import type { Message } from '@yuanai/types'
import { MobileMessageItem } from '@/components/MobileMessageItem'
import { MobileChatInput } from '@/components/MobileChatInput'
import { ModelSelectorSheet } from '@/components/ModelSelectorSheet'

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const insets = useSafeAreaInsets()
  const listRef = useRef(null)
  const queryClient = useQueryClient()
  const [selectedModel, setSelectedModel] = useState('gpt-4o')

  const { streamingMessageId, streamingContent, startStreaming, appendToken, stopStreaming } =
    useChatStore()
  const { sendMessage } = useStream()

  const { data } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () =>
      apiClient.get(`/chat/conversations/${conversationId}/messages`).then((r) => r.data),
    enabled: !!conversationId,
  })

  const messages: Message[] = data?.messages ?? []

  const handleSend = async (content: string, fileIds: string[]) => {
    await sendMessage({
      conversationId: conversationId!,
      model: selectedModel,
      content,
      fileIds,
      onStart: (_, assistantMsgId) => {
        startStreaming(assistantMsgId)
        // 滚动到底部
        listRef.current?.scrollToEnd?.({ animated: true })
      },
      onToken: (token) => {
        appendToken(token)
        listRef.current?.scrollToEnd?.({ animated: false })
      },
      onEnd: () => {
        stopStreaming()
        void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
      },
      onError: stopStreaming,
    })
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 顶部工具栏 */}
      <ModelSelectorSheet selected={selectedModel} onSelect={setSelectedModel} />

      {/* 消息列表 */}
      <FlashList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => (
          <MobileMessageItem
            message={item}
            isStreaming={item.id === streamingMessageId}
            streamingContent={streamingMessageId === item.id ? streamingContent : undefined}
          />
        )}
        estimatedItemSize={80}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
      />

      {/* 输入框 */}
      <MobileChatInput onSend={handleSend} bottomInset={insets.bottom} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
})
```

---

## Step 6：移动端特有组件

### `apps/mobile/components/MobileChatInput.tsx`

实现要点：

- 使用 `KeyboardAvoidingView` 或 `react-native-keyboard-controller` 处理软键盘
- `TextInput multiline` 自动高度（`onContentSizeChange`）
- 附件按钮：调用 `expo-image-picker` 或 `expo-document-picker`
- 上传图片后显示 thumbnail 预览条
- `paddingBottom: bottomInset + 8` 适配 iPhone 底部安全区
- 发送时 `Haptics.impactAsync(ImpactFeedbackStyle.Light)`

### `apps/mobile/components/MobileMessageItem.tsx`

实现要点：

- 用户消息：右对齐渐变气泡
- AI 消息：左对齐 + AI 头像 + `react-native-markdown-display` 渲染
- 流式消息：显示 `streamingContent` + 闪烁光标动画（`Animated.loop`）
- 代码块：`react-native-syntax-highlighter` + 复制按钮（`Clipboard.setStringAsync`）
- 长按消息：弹出操作菜单（复制/重新生成）

### `apps/mobile/components/ConversationList.tsx`

实现要点：

- 顶部：「新建对话」按钮
- `FlatList` 显示会话（从 TanStack Query 获取）
- 左滑显示「删除」操作（`react-native-gesture-handler Swipeable`）
- 长按显示「重命名」ActionSheet
- 底部：用户信息 + 退出按钮

---

## Step 7：测试设备适配

### 手机端清单

- [ ] iPhone 15（刘海/动态岛）底部安全区正常
- [ ] Android 导航栏（手势/按钮）适配
- [ ] 软键盘弹出时输入框上移正常
- [ ] 图片上传（相册/相机）权限请求正常
- [ ] 文档上传（PDF）正常预览

### 平板端清单

- [ ] iPad 横屏：侧边栏固定展开，内容区正常
- [ ] iPad 竖屏：侧边栏固定展开
- [ ] Android 平板（768px+）：双栏布局正确

---

## 验收标准

1. `npx expo start` 无报错，iOS Simulator 正常启动
2. 登录/注册正常，token 持久化到 SecureStore
3. 会话列表正常加载，左滑删除功能正常
4. 新建对话 → 发送消息 → 流式 AI 回复实时显示
5. Markdown 和代码块正常渲染，代码可复制
6. 图片上传后显示预览缩略图，发送成功
7. 键盘弹出/收起时输入区域平滑移动，不遮挡
8. iPad（≥768px）显示固定双栏布局
9. 系统深色模式自动切换到深色样式
10. `pnpm typecheck` 无报错
