import * as Clipboard from 'expo-clipboard'
import { Check, Copy, Pencil } from 'lucide-react-native'
import { memo, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useTranslation } from 'react-i18next'

import { useToast } from '@/components/ui/Toast'
import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface UserMessageProps {
  content: string
  /** 处于内联编辑态：气泡换成可编辑 TextInput + 取消/提交 */
  editing?: boolean
  /** 气泡下方显示操作图标行（复制/编辑）；乐观占位传 false */
  showActions?: boolean
  onStartEdit?: () => void
  onSubmitEdit?: (text: string) => void
  onCancelEdit?: () => void
  /** 字号/密度快照，供 memo 在偏好变化时失效 */
  prefsKey?: string
}

/**
 * 用户消息气泡：右对齐 + 品牌纯色底 + 白字。
 *
 * - 不做 Markdown 渲染（用户输入是纯文本，避免 XSS-like 注入错觉）
 * - 操作不走长按弹层：气泡下方常驻小图标行（复制/编辑），对齐 DeepSeek 的直点交互
 * - 宽度 max 78% —— 与 iOS iMessage / Web 版视觉一致，超长会自动换行
 * - memo：流式期间列表高频重渲染，历史气泡 props 不变直接跳过
 *
 * 编辑态直接内联在列表项里（而不是弹层）：改完提交等价于「以新内容再发一条」，
 * 与 web `UserMessage` inline edit 行为一致，原消息保留在历史中。
 */
function UserMessageBase({
  content,
  editing = false,
  showActions = false,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  prefsKey: _prefsKey,
}: UserMessageProps): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const [draft, setDraft] = useState(content)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<TextInput>(null)
  const toast = useToast()

  // 每次进入编辑态都用当前内容重置草稿（上一次取消的残留不该带进来）
  useEffect(() => {
    if (editing) setDraft(content)
  }, [editing, content])

  const handleCopy = (): void => {
    void Clipboard.setStringAsync(content)
    setCopied(true)
    toast.show(t('chat.copiedToast'))
    setTimeout(() => setCopied(false), 1500)
  }

  const typeStyle = {
    fontSize: theme.typography.body,
    lineHeight: theme.typography.bodyLineHeight,
  }
  const rowPad = { paddingVertical: theme.density.messagePy }

  if (editing) {
    const trimmed = draft.trim()
    return (
      <View style={[styles.editRow, rowPad]}>
        <View
          style={[
            styles.editCard,
            { borderColor: theme.border.focus, backgroundColor: theme.bg.surface },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            style={[styles.editInput, typeStyle, { color: theme.text.primary }]}
            placeholderTextColor={theme.text.muted}
            accessibilityLabel={t('chat.editMessage')}
          />
          <View style={styles.editActions}>
            <Pressable
              onPress={onCancelEdit}
              android_ripple={{
                color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              }}
              style={[styles.editBtn, styles.editBtnGhost, { backgroundColor: theme.bg.elevated }]}
              accessibilityRole="button"
              accessibilityLabel={t('chat.cancelEdit')}
            >
              <Text style={[styles.editBtnGhostText, { color: theme.text.secondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmitEdit?.(trimmed)}
              disabled={trimmed.length === 0}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
              style={[styles.editBtn, trimmed.length === 0 && styles.editBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('chat.submitEdit')}
              accessibilityState={{ disabled: trimmed.length === 0 }}
            >
              <Text style={styles.editBtnText}>{t('common.submit')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.row, rowPad]}>
      <View style={styles.bubble}>
        <Text selectable style={[styles.text, typeStyle]}>
          {content}
        </Text>
      </View>
      {showActions ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handleCopy}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('chat.copyMessage')}
          >
            {copied ? (
              <Check size={14} color={brand.solid} />
            ) : (
              <Copy size={14} color={theme.text.muted} />
            )}
          </Pressable>
          <Pressable
            onPress={onStartEdit}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('chat.editMessage')}
          >
            <Pencil size={14} color={theme.text.muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

/** 列表内联绑定回调导致身份变化，memo 只比较数据类 props。 */
export const UserMessage = memo(
  UserMessageBase,
  (prev, next) =>
    prev.content === next.content &&
    prev.editing === next.editing &&
    prev.showActions === next.showActions &&
    prev.prefsKey === next.prefsKey
)

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
  },
  bubble: {
    maxWidth: '78%',
    backgroundColor: brand.solid,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.chat,
    borderBottomRightRadius: 4,
  },
  text: {
    color: '#FFFFFF',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  iconBtn: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  editRow: {
    paddingHorizontal: spacing.lg,
  },
  editCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  editInput: {
    maxHeight: 160,
    padding: 0,
    textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  editBtn: {
    minWidth: 64,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brand.solid,
  },
  editBtnDisabled: { opacity: 0.45 },
  editBtnGhost: {},
  editBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  editBtnGhostText: { fontSize: 14, fontWeight: '600' },
})
