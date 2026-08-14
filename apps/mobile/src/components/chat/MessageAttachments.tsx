import React, { useState } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import type { MessageFile } from '@yuanai/types'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'

import { formatBytes, isImageMime, mimeIcon } from './attachmentMeta'

interface MessageAttachmentsProps {
  files: readonly MessageFile[]
}

const IMG_MAX = 220

/**
 * 消息内附件展示（用户气泡上方）：
 * - 图片：圆角缩略图（等比收缩到 220pt 内），加载失败降级文件卡片
 * - 其他文件：mime 图标 + 文件名 + 大小 的卡片
 * 点击后交给系统图片/文档查看器打开；下载与应用关联由操作系统处理。
 */
export function MessageAttachments({ files }: MessageAttachmentsProps): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <View style={styles.wrap}>
      {files.map((f) =>
        isImageMime(f.mimeType) ? (
          <ImageAttachment key={f.id} file={f} />
        ) : (
          <FileCard key={f.id} file={f} />
        )
      )}
    </View>
  )
}

function ImageAttachment({ file }: { file: MessageFile }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileCard file={file} />
  return (
    <Pressable
      onPress={() => void Linking.openURL(file.url)}
      accessibilityRole="button"
      accessibilityLabel={`预览图片 ${file.filename}`}
    >
      <Image
        source={{ uri: file.url }}
        style={styles.image}
        resizeMode="cover"
        accessibilityLabel={file.filename}
        onError={() => setFailed(true)}
      />
    </Pressable>
  )
}

function FileCard({ file }: { file: MessageFile }): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
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
      <Text style={styles.cardIcon}>{mimeIcon(file.mimeType)}</Text>
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, { color: theme.text.primary }]} numberOfLines={1}>
          {file.filename}
        </Text>
        <Text style={[styles.cardMeta, { color: theme.text.muted }]}>
          {formatBytes(file.sizeBytes)}
        </Text>
      </View>
    </Pressable>
  )
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
  cardIcon: { fontSize: 20 },
  cardBody: { flexShrink: 1 },
  cardName: { fontSize: 13, fontWeight: '600' },
  cardMeta: { fontSize: 11, marginTop: 1 },
})
