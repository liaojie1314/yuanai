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

import { getAttachmentMeta, isImageAttachment } from './attachmentMeta'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface AttachmentTrayProps {
  attachments: AttachmentItem[]
  onRemove: (localKey: string) => void
}

export function AttachmentTray({ attachments, onRemove }: AttachmentTrayProps): React.JSX.Element {
  const t = useTheme()
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
        <View
          key={item.localKey}
          style={[styles.cell, { backgroundColor: t.bg.elevated, borderColor: t.border.default }]}
        >
          {isImageAttachment(item.mimeType, item.name) ? (
            <Image
              source={{ uri: item.uri }}
              style={styles.thumb}
              resizeMode="cover"
              accessibilityLabel={item.name}
            />
          ) : (
            <DocumentThumbnail mimeType={item.mimeType} name={item.name} />
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

/** 输入区文档缩略图，和历史消息附件卡复用同一套类型图标。 */
function DocumentThumbnail({
  mimeType,
  name,
}: {
  mimeType: string
  name: string
}): React.JSX.Element {
  const t = useTheme()
  const { Icon } = getAttachmentMeta(mimeType, name)

  return (
    <View style={styles.docThumb}>
      <Icon size={23} color={t.text.secondary} strokeWidth={1.8} aria-hidden />
      <Text style={[styles.docName, { color: t.text.secondary }]} numberOfLines={2}>
        {name}
      </Text>
    </View>
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
    borderWidth: StyleSheet.hairlineWidth,
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
  docName: {
    fontSize: 9,
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
