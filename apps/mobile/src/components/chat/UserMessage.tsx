import * as Clipboard from 'expo-clipboard'
import { Check, Copy, Pencil } from 'lucide-react-native'
import { memo, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useToast } from '@/components/ui/Toast'
import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'

interface UserMessageProps {
  content: string
  /** 处于内联编辑态：气泡换成可编辑 TextInput + 取消/提交 */
  editing?: boolean
  /** 气泡下方显示操作图标行（复制/编辑）；乐观占位传 false */
  showActions?: boolean
  onStartEdit?: () => void
  onSubmitEdit?: (text: string) => void
  onCancelEdit?: () => void
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
}: UserMessageProps): React.JSX.Element {
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
    toast.show('已复制到剪贴板')
    setTimeout(() => setCopied(false), 1500)
  }

  if (editing) {
    const trimmed = draft.trim()
    return (
      <View style={styles.editRow}>
        <View style={styles.editCard}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            style={styles.editInput}
            placeholderTextColor={text.muted}
            accessibilityLabel="编辑消息内容"
          />
          <View style={styles.editActions}>
            <Pressable
              onPress={onCancelEdit}
              android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
              style={[styles.editBtn, styles.editBtnGhost]}
              accessibilityRole="button"
              accessibilityLabel="取消编辑"
            >
              <Text style={styles.editBtnGhostText}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmitEdit?.(trimmed)}
              disabled={trimmed.length === 0}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
              style={[styles.editBtn, trimmed.length === 0 && styles.editBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="提交编辑"
              accessibilityState={{ disabled: trimmed.length === 0 }}
            >
              <Text style={styles.editBtnText}>提交</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Text selectable style={styles.text}>
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
            accessibilityLabel="复制消息"
          >
            {copied ? (
              <Check size={14} color={brand.solid} />
            ) : (
              <Copy size={14} color={text.muted} />
            )}
          </Pressable>
          <Pressable
            onPress={onStartEdit}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="编辑消息"
          >
            <Pencil size={14} color={text.muted} />
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
    prev.showActions === next.showActions
)

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bubble: {
    maxWidth: '78%',
    backgroundColor: brand.solid,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.chat,
    borderBottomRightRadius: 4, // "尾巴"缺角，视觉指向发言人一侧
  },
  text: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  iconBtn: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  // ── 编辑态 ──
  editRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  editCard: {
    borderWidth: 1,
    borderColor: border.focus,
    borderRadius: radius.md,
    backgroundColor: bg.surface,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  editInput: {
    fontSize: 15,
    lineHeight: 22,
    color: text.primary,
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
  editBtnGhost: { backgroundColor: bg.elevated },
  editBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  editBtnGhostText: { fontSize: 14, fontWeight: '600', color: text.secondary },
})
