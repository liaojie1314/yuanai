/**
 * 附件上传状态管理 hook。
 *
 * 职责：
 * 1. 弹出选择 actionSheet（相册 / 拍照 / 文件），拿 uri 列表
 * 2. 并发发起上传，维护每项的 fileId / progress / error
 * 3. 对外暴露 attachments 列表、remove、clear、getFileIds、isUploading
 *
 * 不依赖任何平台外 API（RN 是 mobile 专属，iOS/Android 均可）。
 */

import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'

import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import {
  ensureCameraPermission,
  ensureDocumentPickerReady,
  ensureMediaLibraryPermission,
} from '@/lib/permissions'
import { uploadFileMobile } from '@/lib/mobileUploader'

export interface AttachmentItem {
  /** 本地唯一 key：使用 uri；相机拍出的 uri 也是唯一的 */
  localKey: string
  /** 本地 URI，供缩略图 / 预览使用 */
  uri: string
  name: string
  mimeType: string
  sizeBytes: number
  /** null = 上传中；string = 已上传，值为后端 File ID */
  fileId: string | null
  /** 0-100，仅 fileId===null 时有意义 */
  progress: number
  /** 上传出错时的中文错误消息 */
  error: string | null
}

export interface UseAttachmentsReturn {
  attachments: AttachmentItem[]
  /** 弹出选择来源 actionSheet 并开始上传 */
  openAttachSheet: () => Promise<void>
  /** 从列表移除一条附件（不论是否上传完成） */
  remove: (localKey: string) => void
  /** 清空所有附件（发送成功后调用） */
  clear: () => void
  /** 返回已成功上传的 fileId 数组（过滤掉上传中 / 出错的） */
  getFileIds: () => string[]
  /** 是否有附件正在上传（用于禁用发送按钮） */
  isUploading: boolean
}

export function useAttachments(disabled = false): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const dialog = useDialog()
  const toast = useToast()

  /** 把 raw 文件项追加到列表并并发上传 */
  const addAndUpload = useCallback(
    async (
      items: Array<{ uri: string; name: string; mimeType: string; sizeBytes: number }>
    ): Promise<void> => {
      if (items.length === 0) return

      const newItems: AttachmentItem[] = items.map((item) => ({
        localKey: item.uri,
        uri: item.uri,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        fileId: null,
        progress: 0,
        error: null,
      }))

      setAttachments((prev) => [...prev, ...newItems])

      await Promise.all(
        newItems.map(async (item) => {
          try {
            const result = await uploadFileMobile({
              uri: item.uri,
              name: item.name,
              mimeType: item.mimeType,
              onProgress: (p) => {
                setAttachments((prev) =>
                  prev.map((a) => (a.localKey === item.localKey ? { ...a, progress: p } : a))
                )
              },
            })
            setAttachments((prev) =>
              prev.map((a) =>
                a.localKey === item.localKey
                  ? { ...a, fileId: result.id, progress: 100, error: null }
                  : a
              )
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : '上传失败'
            setAttachments((prev) =>
              prev.map((a) =>
                a.localKey === item.localKey ? { ...a, error: msg, progress: 0 } : a
              )
            )
            toast.show(`${item.name.slice(0, 20)} 上传失败`)
          }
        })
      )
    },
    [toast]
  )

  const openAttachSheet = useCallback(async (): Promise<void> => {
    if (disabled) return

    const idx = await dialog.actionSheet({
      title: '添加附件',
      actions: [{ label: '从相册选取' }, { label: '拍照' }, { label: '选择文件' }],
    })

    if (idx === -1) return

    if (idx === 0) {
      // 相册多选
      const ok = await ensureMediaLibraryPermission()
      if (!ok) return
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
      })
      if (result.canceled || result.assets.length === 0) return
      await addAndUpload(
        result.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? a.uri.split('/').pop() ?? 'image.jpg',
          mimeType: a.mimeType ?? 'image/jpeg',
          sizeBytes: a.fileSize ?? 0,
        }))
      )
    } else if (idx === 1) {
      // 拍照
      const ok = await ensureCameraPermission()
      if (!ok) return
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 })
      if (result.canceled || result.assets.length === 0) return
      const a = result.assets[0]
      if (!a) return
      await addAndUpload([
        {
          uri: a.uri,
          name: a.fileName ?? 'photo.jpg',
          mimeType: a.mimeType ?? 'image/jpeg',
          sizeBytes: a.fileSize ?? 0,
        },
      ])
    } else if (idx === 2) {
      // 文档
      const ok = await ensureDocumentPickerReady()
      if (!ok) return
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled || result.assets.length === 0) return
      await addAndUpload(
        result.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType ?? 'application/octet-stream',
          sizeBytes: a.size ?? 0,
        }))
      )
    }
  }, [disabled, dialog, addAndUpload])

  const remove = useCallback((localKey: string): void => {
    setAttachments((prev) => prev.filter((a) => a.localKey !== localKey))
  }, [])

  const clear = useCallback((): void => {
    setAttachments([])
  }, [])

  const getFileIds = useCallback((): string[] => {
    return attachments.filter((a) => a.fileId !== null).map((a) => a.fileId as string)
  }, [attachments])

  const isUploading = attachments.some((a) => a.fileId === null && a.error === null)

  return { attachments, openAttachSheet, remove, clear, getFileIds, isUploading }
}
