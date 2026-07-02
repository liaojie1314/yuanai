import { create } from 'zustand'

/**
 * Artifact 面板显示模式：
 * - `view`：只读展示代码/文档
 * - `run`：在受限 iframe 沙箱中运行 HTML/CSS/JS
 */
export type ArtifactMode = 'view' | 'run'

/**
 * Artifact 面板当前承载的内容。
 */
export interface ArtifactPayload {
  /** 面板顶部标题（默认与代码语言拼接） */
  title: string
  /** 代码语言，例如 `typescript`、`html`、`css`、`javascript` */
  lang: string
  /** 代码正文 */
  code: string
  /** 显示模式 */
  mode: ArtifactMode
}

interface ArtifactState {
  /** 面板是否展开 */
  open: boolean
  /** 面板当前承载的内容；关闭状态时为 null */
  payload: ArtifactPayload | null

  /**
   * 打开面板以只读模式展示代码。
   * @param payload - 代码内容与元信息（`mode` 会被强制为 `view`）
   */
  openView: (payload: Omit<ArtifactPayload, 'mode'>) => void

  /**
   * 打开面板以运行模式执行代码（仅 HTML/CSS/JS）。
   * @param payload - 代码内容与元信息（`mode` 会被强制为 `run`）
   */
  openRun: (payload: Omit<ArtifactPayload, 'mode'>) => void

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

  openView: (payload) => set({ open: true, payload: { ...payload, mode: 'view' } }),

  openRun: (payload) => set({ open: true, payload: { ...payload, mode: 'run' } }),

  close: () => set({ open: false, payload: null }),
}))
