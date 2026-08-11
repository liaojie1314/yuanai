import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  SourcesOptions,
  WebContents,
} from 'electron'

import type { DesktopScreenSource } from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'
import type { SelectedFileRegistry } from '../protocol/selected-file'

const OPEN_FILES_OPTIONS = {
  buttonLabel: '添加',
  filters: [
    {
      extensions: [
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'pdf',
        'txt',
        'md',
        'csv',
        'json',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
      ],
      name: '图片和文档',
    },
    { extensions: ['*'], name: '所有文件' },
  ],
  properties: ['openFile', 'multiSelections'],
  title: '选择要上传的文件',
} satisfies OpenDialogOptions

const SCREEN_SOURCE_OPTIONS = {
  fetchWindowIcons: false,
  // `desktopCapturer` 返回的 thumbnail 会直接作为聊天附件上传，不能使用选择器预览尺寸。
  // 4096 上限覆盖常见 4K 显示器，同时避免超高分屏捕获造成不可控的 IPC 负载。
  thumbnailSize: { height: 4096, width: 4096 },
  types: ['screen', 'window'],
} satisfies SourcesOptions

/** Electron 原生文件选择器的最小依赖。 */
export interface NativeFileDialog {
  /** 展示仅允许选择文件的原生多选对话框。 */
  showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  /** 在指定主窗口前展示仅允许选择文件的原生多选对话框。 */
  showOpenDialog(
    browserWindow: BrowserWindow,
    options: OpenDialogOptions
  ): Promise<{ canceled: boolean; filePaths: string[] }>
}

/** 可将系统屏幕或窗口转换为 data URL 缩略图的 Electron 原生能力。 */
export interface NativeDesktopCapturer {
  /** 枚举可由用户明确选择的屏幕和窗口。 */
  getSources(options: SourcesOptions): Promise<
    Array<{
      id: string
      name: string
      thumbnail: { isEmpty(): boolean; toDataURL(): string }
    }>
  >
}

/** 原生文件选择 IPC 的显式依赖。 */
export interface DialogIpcOptions {
  /** 固定通道注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 原生文件选择能力。 */
  dialog: NativeFileDialog
  /** 原生屏幕与窗口缩略图能力。 */
  desktopCapturer: NativeDesktopCapturer
  /** 由主进程创建的 sender 所属窗口查找器。 */
  getWindow(webContents: WebContents): BrowserWindow | null
  /** 仅保存本次原生选择结果的一次性文件注册表。 */
  selectedFiles: SelectedFileRegistry
}

/** 注册只返回受控文件 URL、不向 renderer 暴露本机路径的文件选择 IPC。 */
export function registerDialogIpcHandlers(options: DialogIpcOptions): void {
  options.ipcMain.handle(
    IPC.dialog.openFiles,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      const browserWindow = options.getWindow(event.sender)
      const result = browserWindow
        ? await options.dialog.showOpenDialog(browserWindow, OPEN_FILES_OPTIONS)
        : await options.dialog.showOpenDialog(OPEN_FILES_OPTIONS)
      return result.canceled ? [] : options.selectedFiles.register(result.filePaths)
    }
  )
  options.ipcMain.handle(
    IPC.dialog.listScreenSources,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<DesktopScreenSource[]> => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      const sources = await options.desktopCapturer.getSources(SCREEN_SOURCE_OPTIONS)
      return sources.flatMap((source) =>
        source.thumbnail.isEmpty()
          ? []
          : [
              {
                id: source.id,
                name: source.name || '未命名窗口',
                thumbnailDataUrl: source.thumbnail.toDataURL(),
              },
            ]
      )
    }
  )
}
