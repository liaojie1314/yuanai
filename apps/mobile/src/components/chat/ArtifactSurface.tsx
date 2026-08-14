import * as Clipboard from 'expo-clipboard'
import { Check, Code2, Copy, Play, X } from 'lucide-react-native'
import { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WebViewMessageEvent } from 'react-native-webview'

// pnpm 布局下 webview 的 class 声明会链到另一份 @types/react（19）导致
// JSX 组件类型不兼容；按 SyntaxHighlighter 同款 require+cast 绕开。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebView } = require('react-native-webview') as {
  WebView: React.ComponentType<{
    source: { html: string }
    originWhitelist?: string[]
    javaScriptEnabled?: boolean
    domStorageEnabled?: boolean
    onMessage?: (event: WebViewMessageEvent) => void
    style?: object
  }>
}

import { useArtifactStore } from '@yuanai/core/stores'

import {
  ARTIFACT_MSG_SOURCE,
  buildRunSrcDoc,
  isDataPreviewLang,
  isRunnableLang,
  TABLET_MIN_WIDTH,
} from '@yuanai/core'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'

import { ArtifactDataPreview } from './ArtifactDataPreview'
import { HighlightedCode } from './HighlightedCode'

/** 面板内代码高亮上限（与 CodeBlock 同阈值，超过降级纯文本防 ANR） */
const PANEL_HIGHLIGHT_MAX_LINES = 300

interface ConsoleLine {
  level: string
  text: string
}

/**
 * Artifact 面板承载屏：代码高亮 + 沙箱预览（对齐 web ArtifactPanel）。
 *
 * - 代码 tab：HighlightedCode（hljs atom-one，随主题）
 * - 预览 tab：可运行语言（html/js/jsx/tsx/vue/svelte/md/mermaid…）用 WebView
 *   加载 `buildRunSrcDoc` 产物；沙箱 console/错误经
 *   `window.ReactNativeWebView.postMessage` 回传，渲染在底部控制台条。
 * - 打开来源：CodeBlock「面板」按钮（view 模式默认代码 tab）；
 *   可运行语言自动显示预览 tab。
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
  const [tab, setTab] = useState<'code' | 'preview'>('code')
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const codePayload = payload?.kind === 'code' ? payload : null

  const runnable = codePayload ? isRunnableLang(codePayload.lang) : false
  const isData = codePayload ? isDataPreviewLang(codePayload.lang) : false
  const dark = theme.colorScheme === 'dark'
  const srcDoc = useMemo(
    () =>
      codePayload && runnable ? buildRunSrcDoc(codePayload.lang, codePayload.code, { dark }) : '',
    [codePayload, runnable, dark]
  )
  const showPreview = (runnable || isData) && tab === 'preview'

  // openRun 载荷（mode=run）默认落在预览 tab；view 默认代码 tab
  useEffect(() => {
    if (open) setTab(codePayload?.mode === 'run' && (runnable || isData) ? 'preview' : 'code')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, codePayload?.mode])

  // 文件卡片在消息里直接交由操作系统的图片/文档查看器打开。该分支是对共享 store
  // 的防御性处理，正常文件预览不会占用代码 Artifact 面板。
  useEffect(() => {
    if (!open || payload?.kind !== 'file') return
    void Linking.openURL(payload.url)
      .catch(() => undefined)
      .finally(close)
  }, [close, open, payload])

  const onCopy = async (): Promise<void> => {
    if (!codePayload) return
    await Clipboard.setStringAsync(codePayload.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onClose = (): void => {
    setTab('code')
    setLogs([])
    close()
  }

  const onWebViewMessage = (event: WebViewMessageEvent): void => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        source?: string
        level?: string
        text?: string
      }
      if (msg.source !== ARTIFACT_MSG_SOURCE) return
      setLogs((prev) => [...prev.slice(-49), { level: msg.level ?? 'log', text: msg.text ?? '' }])
    } catch {
      /* 非桥消息忽略 */
    }
  }

  if (!open || !codePayload) return null

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
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
              {codePayload.title || 'Artifact'}
            </Text>
            <Text style={[styles.lang, { color: theme.text.muted }]}>{codePayload.lang}</Text>
          </View>
          {runnable || isData ? (
            <View style={[styles.tabs, { borderColor: theme.border.default }]}>
              <Pressable
                onPress={() => setTab('code')}
                style={[styles.tabBtn, tab === 'code' && { backgroundColor: theme.brand.selected }]}
                accessibilityLabel={t('chat.artifactCode')}
              >
                <Code2
                  size={13}
                  color={tab === 'code' ? theme.brand.selectedFg : theme.text.secondary}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: tab === 'code' ? theme.brand.selectedFg : theme.text.secondary },
                  ]}
                >
                  {t('chat.artifactCode')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setLogs([])
                  setTab('preview')
                }}
                style={[
                  styles.tabBtn,
                  tab === 'preview' && { backgroundColor: theme.brand.selected },
                ]}
                accessibilityLabel={t('chat.artifactPreview')}
              >
                <Play
                  size={13}
                  color={tab === 'preview' ? theme.brand.selectedFg : theme.text.secondary}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: tab === 'preview' ? theme.brand.selectedFg : theme.text.secondary },
                  ]}
                >
                  {t('chat.artifactPreview')}
                </Text>
              </Pressable>
            </View>
          ) : null}
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
            onPress={onClose}
            hitSlop={6}
            style={styles.actionBtn}
            accessibilityLabel={t('common.close')}
          >
            <X size={18} color={theme.text.primary} />
          </Pressable>
        </View>

        {showPreview && isData ? (
          <ArtifactDataPreview lang={codePayload.lang} code={codePayload.code} />
        ) : showPreview ? (
          <View style={styles.previewWrap}>
            <WebView
              key={srcDoc}
              source={{ html: srcDoc }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled={false}
              onMessage={onWebViewMessage}
              style={[styles.webview, { backgroundColor: dark ? '#10151f' : '#FFFFFF' }]}
            />
            {logs.length > 0 ? (
              <ScrollView
                style={[
                  styles.consoleBar,
                  { borderTopColor: theme.border.default, backgroundColor: theme.bg.elevated },
                ]}
              >
                {logs.map((line, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.consoleLine,
                      {
                        color: line.level === 'error' ? theme.border.danger : theme.text.secondary,
                      },
                    ]}
                  >
                    {line.text}
                  </Text>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : (
          <ScrollView
            style={[
              styles.body,
              { backgroundColor: theme.colorScheme === 'dark' ? '#1C2130' : '#F7F7F5' },
            ]}
            contentContainerStyle={{ padding: spacing.lg }}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HighlightedCode
                code={codePayload.code}
                language={codePayload.lang}
                maxLines={PANEL_HIGHLIGHT_MAX_LINES}
              />
            </ScrollView>
          </ScrollView>
        )}
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
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tabLabel: { fontSize: 12, fontWeight: '600' },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  previewWrap: { flex: 1 },
  webview: { flex: 1 },
  consoleBar: {
    maxHeight: 120,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  consoleLine: { fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
})
