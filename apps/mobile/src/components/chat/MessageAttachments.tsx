import { Maximize2 } from 'lucide-react-native'
import React, { useMemo, useState } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import type { MessageFile } from '@yuanai/types'
import { useAuthStore } from '@yuanai/core/stores'

import { getMobileImageSource } from '@/lib/filePreview'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'
import { useImagePreview } from '@/components/ui/ImagePreview'

import { formatBytes, getAttachmentMeta, isImageAttachment } from './attachmentMeta'

interface MessageAttachmentsProps {
  files: readonly MessageFile[]
}

const IMG_MAX = 220

/**
 * 消息内附件展示（用户气泡上方）：
 * - 图片：圆角缩略图，点击在根级全屏预览器中连续浏览同一消息的所有图片
 * - 其他文件：mime 图标 + 文件名 + 大小 的卡片
 * 点击文档后交给系统查看器打开；下载与应用关联由操作系统处理。
 */
export function MessageAttachments({ files }: MessageAttachmentsProps): React.JSX.Element | null {
  const { open } = useImagePreview()
  const accessToken = useAuthStore((state) => state.accessToken)
  const imageFiles = useMemo(
    () => files.filter((file) => isImageAttachment(file.mimeType, file.filename)),
    [files]
  )

  if (files.length === 0) return null
  return (
    <View style={styles.wrap}>
      {files.map((f) =>
        isImageAttachment(f.mimeType, f.filename) ? (
          <ImageAttachment
            key={f.id}
            file={f}
            accessToken={accessToken}
            onPreview={() => open(imageFiles, f.id)}
          />
        ) : (
          <FileCard key={f.id} file={f} />
        )
      )}
    </View>
  )
}

function ImageAttachment({
  file,
  accessToken,
  onPreview,
}: {
  file: MessageFile
  accessToken: string | null
  onPreview: () => void
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileCard file={file} />
  return (
    <Pressable
      onPress={onPreview}
      style={styles.imageButton}
      accessibilityRole="button"
      accessibilityLabel={`预览图片 ${file.filename}`}
    >
      <Image
        source={getMobileImageSource(file, accessToken)}
        style={styles.image}
        resizeMode="cover"
        accessibilityLabel={file.filename}
        onError={() => setFailed(true)}
      />
      <View style={styles.imagePreviewBadge} pointerEvents="none">
        <Maximize2 size={15} color="#FFFFFF" aria-hidden />
      </View>
    </Pressable>
  )
}

function FileCard({ file }: { file: MessageFile }): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const meta = getAttachmentMeta(file.mimeType, file.filename)
  const { Icon } = meta
  return (
    <Pressable
      onPress={() => void Linking.openURL(file.url)}
      style={[
        styles.card,
        { backgroundColor: theme.bg.elevated, borderColor: theme.border.default },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`预览 ${t('chat.attachmentFile', { name: file.filename })}`}
    >
      <View style={[styles.cardIcon, { backgroundColor: fileIconBackground(meta.kind) }]}>
        <Icon size={20} color={fileIconColor(meta.kind)} strokeWidth={1.8} aria-hidden />
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, { color: theme.text.primary }]} numberOfLines={1}>
          {file.filename}
        </Text>
        <Text style={[styles.cardMeta, { color: theme.text.muted }]}>
          {meta.label} · {formatBytes(file.sizeBytes)}
        </Text>
      </View>
    </Pressable>
  )
}

function fileIconBackground(kind: ReturnType<typeof getAttachmentMeta>['kind']): string {
  if (kind === 'pdf') return '#FEE2E2'
  if (kind === 'sheet') return '#DCFCE7'
  if (kind === 'image') return '#DBEAFE'
  if (kind === 'archive') return '#FEF3C7'
  return '#E8EDF5'
}

function fileIconColor(kind: ReturnType<typeof getAttachmentMeta>['kind']): string {
  if (kind === 'pdf') return '#DC2626'
  if (kind === 'sheet') return '#16A34A'
  if (kind === 'image') return '#2563EB'
  if (kind === 'archive') return '#B45309'
  return '#546273'
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: '78%',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    alignItems: 'flex-end',
  },
  image: {
    width: IMG_MAX,
    height: IMG_MAX * 0.75,
    borderRadius: radius.md,
  },
  imageButton: { position: 'relative', borderRadius: radius.md, overflow: 'hidden' },
  imagePreviewBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 260,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flexShrink: 1 },
  cardName: { fontSize: 13, fontWeight: '600' },
  cardMeta: { fontSize: 11, marginTop: 1 },
})
