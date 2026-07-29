/**
 * 附件预览条 — 渲染在 ChatInput 工具行上方。
 *
 * 每项附件：
 * - 图片：expo-image 缩略图（60×60）
 * - 文档：mime 图标字符 + 文件名截断
 * - 右上角 × 删除按钮
 * - 上传中显示半透明遮罩 + ActivityIndicator
 * - 上传出错显示红色感叹号
 */

import { X } from 'lucide-react-native'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import type { AttachmentItem } from '@/hooks/useAttachments'
import { bg, border, radius, spacing, text } from '@/theme/tokens'

interface AttachmentTrayProps {
  attachments: AttachmentItem[]
  onRemove: (localKey: string) => void
}

/** 根据 mimeType 返回代表字符（文档图标占位） */
function mimeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📄'
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.endsWith('.xlsx') ||
    mimeType.endsWith('.xls')
  )
    return '📊'
  if (
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint') ||
    mimeType.endsWith('.pptx')
  )
    return '📋'
  if (mimeType.includes('word') || mimeType.endsWith('.docx') || mimeType.endsWith('.doc'))
    return '📝'
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive'))
    return '🗜'
  if (mimeType.includes('text/')) return '📃'
  return '📎'
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function AttachmentTray({ attachments, onRemove }: AttachmentTrayProps): React.JSX.Element {
  if (attachments.length === 0) return <></>

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {attachments.map((item) => (
        <View key={item.localKey} style={styles.cell}>
          {isImage(item.mimeType) ? (
            <Image
              source={{ uri: item.uri }}
              style={styles.thumb}
              resizeMode="cover"
              accessibilityLabel={item.name}
            />
          ) : (
            <View style={styles.docThumb}>
              <Text style={styles.docIcon}>{mimeIcon(item.mimeType)}</Text>
              <Text style={styles.docName} numberOfLines={2}>
                {item.name}
              </Text>
            </View>
          )}

          {/* 上传中遮罩 */}
          {item.fileId === null && item.error === null ? (
            <View style={styles.overlay}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          ) : null}

          {/* 上传出错遮罩 */}
          {item.error !== null ? (
            <View style={[styles.overlay, styles.errorOverlay]}>
              <Text style={styles.errorIcon}>!</Text>
            </View>
          ) : null}

          {/* 删除按钮 */}
          <Pressable
            onPress={() => onRemove(item.localKey)}
            style={styles.removeBtn}
            hitSlop={4}
            accessibilityLabel={`移除 ${item.name}`}
          >
            <X size={10} color="#FFFFFF" strokeWidth={3} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}

const CELL = 64

const styles = StyleSheet.create({
  scroll: {
    flexShrink: 0,
    marginBottom: spacing.xs,
  },
  scrollContent: {
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: bg.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
  },
  thumb: {
    width: CELL,
    height: CELL,
  },
  docThumb: {
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    gap: 2,
  },
  docIcon: {
    fontSize: 22,
  },
  docName: {
    fontSize: 9,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: 13,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorOverlay: {
    backgroundColor: 'rgba(239,68,68,0.75)',
  },
  errorIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  removeBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
