import { create } from 'zustand'
import type { MessageFile } from '@yuanai/types'

/**
 * Artifact 面板显示模式：
 * - `view`：只读展示代码/文档
 * - `run`：在受限 iframe 沙箱中运行 HTML/CSS/JS
 */
export type ArtifactMode = 'view' | 'run'

/**
 * Artifact 面板承载的代码内容。
 */
export interface CodeArtifactPayload {
  /** 用于区分代码与文件预览的稳定标识。 */
  kind: 'code'
  /** 面板顶部标题（默认与代码语言拼接） */
  title: string
  /** 代码语言，例如 `typescript`、`html`、`css`、`javascript` */
  lang: string
  /** 代码正文 */
  code: string
  /** 显示模式 */
  mode: ArtifactMode
}

/**
 * Artifact 面板承载的已上传文件引用。
 *
 * 文件原始内容不会写入 Zustand；面板使用 fileId 按需请求受限预览接口，避免把大文件
 * 复制到客户端状态中，也能在切换文件时获得后端最新的提取结果。
 */
export interface FileArtifactPayload {
  /** 用于区分代码与文件预览的稳定标识。 */
  kind: 'file'
  /** 服务端文件 ID。 */
  fileId: string
  /** 面板顶部展示的文件名。 */
  title: string
  /** 服务端记录的 MIME 类型。 */
  mimeType: string
  /** 原始文件下载地址。 */
  url: string
  /** 同一条消息中的全部附件，用于在预览窗口内切换。 */
  files?: readonly MessageFile[]
  /** 当前附件在 `files` 中的下标。 */
  index?: number
}

/**
 * 由生成任务返回的图片或视频预览。
 *
 * 生成结果不是用户上传的 `File` 记录，不能走 `/files/{id}/preview` 查询；面板直接
 * 使用已由后端任务接口返回的受控结果 URL。
 */
export interface MediaArtifactPayload {
  /** 用于与代码和上传文件预览区分的稳定标识。 */
  kind: 'media'
  /** 面板顶部展示的媒体名称。 */
  title: string
  /** 已完成媒体的 MIME 类型。 */
  mimeType: string
  /** 后端任务接口返回的结果 URL。 */
  url: string
}

/** Artifact 面板当前承载的内容。 */
export type ArtifactPayload = CodeArtifactPayload | FileArtifactPayload | MediaArtifactPayload

interface ArtifactState {
  /** 面板是否展开 */
  open: boolean
  /** 面板当前承载的内容；关闭状态时为 null */
  payload: ArtifactPayload | null

  /**
   * 打开面板以只读模式展示代码。
   * @param payload - 代码内容与元信息（`mode` 会被强制为 `view`）
   */
  openView: (payload: Omit<CodeArtifactPayload, 'kind' | 'mode'>) => void

  /**
   * 打开面板以运行模式执行代码（仅 HTML/CSS/JS）。
   * @param payload - 代码内容与元信息（`mode` 会被强制为 `run`）
   */
  openRun: (payload: Omit<CodeArtifactPayload, 'kind' | 'mode'>) => void

  /** 在右侧 Artifact 面板中打开受限文件预览。 */
  openFilePreview: (
    payload: Omit<FileArtifactPayload, 'kind' | 'files' | 'index'> & {
      files?: readonly MessageFile[]
      index?: number
    }
  ) => void

  /** 在右侧 Artifact 面板中直接打开已生成的图片或视频。 */
  openMediaPreview: (payload: Omit<MediaArtifactPayload, 'kind'>) => void

  /** 关闭面板并清空 payload */
  close: () => void
}

/**
 * Artifact 面板全局状态 Store。
 *
 * 让 `CodeBlock` 与 `ArtifactPanel` 解耦：
 * 前者点击时调用 `openView` / `openRun`，
 * 后者订阅 `open` + `payload` 自行渲染。
 */
export const useArtifactStore = create<ArtifactState>()((set) => ({
  open: false,
  payload: null,

  openView: (payload) => set({ open: true, payload: { ...payload, kind: 'code', mode: 'view' } }),

  openRun: (payload) => set({ open: true, payload: { ...payload, kind: 'code', mode: 'run' } }),

  openFilePreview: (payload) =>
    set({
      open: true,
      payload: {
        ...payload,
        ...(payload.files && payload.files.length > 0 ? { files: [...payload.files] } : {}),
        kind: 'file',
      },
    }),

  openMediaPreview: (payload) => set({ open: true, payload: { ...payload, kind: 'media' } }),

  close: () => set({ open: false, payload: null }),
}))
