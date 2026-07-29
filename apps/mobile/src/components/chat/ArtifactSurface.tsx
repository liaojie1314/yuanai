import * as Clipboard from 'expo-clipboard'
import { Check, Copy, X } from 'lucide-react-native'
import { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useArtifactStore } from '@yuanai/core/stores'

import { TABLET_MIN_WIDTH } from '@yuanai/core'

import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'

/**
 * Artifact 面板承载屏（Step 7 MVP：仅 view，不运行）。
 *
 * 打开来源：CodeBlock 的"在面板中查看"按钮 → `useArtifactStore.openView(...)`。
 * 关闭：顶部 X 或系统返回手势（`onRequestClose`）。
 *
 * 平台差异（Step 7.6 规范）：
 * - 手机（< 768pt）：pageSheet Modal + 只读高亮
 * - 平板（≥ 768pt）：docs 规定应做右侧 WebView + srcDoc runtime
 *
 * **本次 MVP 决定**：平板也走 Modal view-only。理由：
 *   1. WebView 运行需要 srcDoc runtime（含 React/Vue/Svelte/Markdown/Mermaid 五套）
 *      共约 300 行 JS 字符串构建 + 沙箱策略 + console 桥接，是独立分量
 *   2. Web 版 `artifact-runtimes.ts` 未抽到 packages/core；抽取本身是一次跨包重构
 *   3. 关闭 Step 7 优先，运行时能力后续单独 PR 覆盖平板 WebView + srcDoc + 抽核
 *
 * 语法高亮：暂用 monospace 直显，与 CodeBlock 一致，避免 syntax-highlighter 的
 * RN 大代码块性能坑（同 CodeBlock 决策）。
 */
export function ArtifactSurface(): React.JSX.Element | null {
  const theme = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const open = useArtifactStore((s) => s.open)
  const payload = useArtifactStore((s) => s.payload)
  const close = useArtifactStore((s) => s.close)
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    if (!payload) return
    await Clipboard.setStringAsync(payload.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!open || !payload) return null

  return (
    <Modal
      visible={open}
      onRequestClose={close}
      presentationStyle="pageSheet"
      animationType="slide"
      transparent={false}
    >
      <View
        style={[
          styles.container,
          isTablet && styles.tabletPad,
          { backgroundColor: theme.bg.surface },
        ]}
      >
        {/* 顶栏 */}
        <View
          style={[
            styles.topBar,
            { borderBottomColor: theme.border.default, paddingTop: insets.top + spacing.sm },
          ]}
        >
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: theme.text.primary }]} numberOfLines={1}>
              {payload.title || 'Artifact'}
            </Text>
            <Text style={[styles.lang, { color: theme.text.muted }]}>{payload.lang}</Text>
          </View>
          <Pressable
            onPress={() => {
              void onCopy()
            }}
            hitSlop={6}
            style={styles.actionBtn}
            accessibilityLabel={t('common.copy')}
          >
            {copied ? (
              <Check size={16} color={theme.text.secondary} />
            ) : (
              <Copy size={16} color={theme.text.secondary} />
            )}
          </Pressable>
          <Pressable
            onPress={close}
            hitSlop={6}
            style={styles.actionBtn}
            accessibilityLabel={t('common.close')}
          >
            <X size={18} color={theme.text.primary} />
          </Pressable>
        </View>

        {/* 代码正文 */}
        <ScrollView
          style={[
            styles.body,
            { backgroundColor: theme.colorScheme === 'dark' ? '#1C2130' : '#F7F7F5' },
          ]}
          contentContainerStyle={{ padding: spacing.lg }}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={[styles.code, { color: theme.text.primary }]}>
              {payload.code}
            </Text>
          </ScrollView>
        </ScrollView>

        {isTablet && payload.mode === 'run' ? (
          <View style={[styles.footer, { borderTopColor: theme.border.default }]}>
            <Text style={[styles.footerHint, { color: theme.text.secondary }]}>
              平板运行时（WebView + srcDoc）待后续 PR，当前只展示代码。
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabletPad: { paddingHorizontal: spacing.xl },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  titleWrap: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  lang: { fontSize: 11, fontFamily: 'monospace', textTransform: 'lowercase' },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: brand.light,
  },
  footerHint: { fontSize: 12 },
})
