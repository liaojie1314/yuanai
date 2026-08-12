import type { DesktopAppearanceState, DesktopThemeChoice } from '../../shared/ipc-contract'

/** Electron 原生主题能力的最小接口。 */
export interface NativeThemeApi {
  /** 控制 Electron 原生控件和标题栏的主题来源。 */
  themeSource: 'system' | 'light' | 'dark'
  /** 当前系统解析后的深色模式状态。 */
  readonly shouldUseDarkColors: boolean
  /** 监听系统主题变化。 */
  on(event: 'updated', listener: () => void): void
  /** 移除系统主题监听。 */
  removeListener(event: 'updated', listener: () => void): void
}

/** 可更新首帧与原生标题栏底色的窗口能力。 */
export interface AppearanceWindow {
  /** 判断窗口是否已经销毁。 */
  isDestroyed(): boolean
  /** 修改窗口原生背景色。 */
  setBackgroundColor(color: string): void
}

/** 桌面外观服务的显式依赖。 */
export interface DesktopAppearanceOptions {
  /** Electron 原生主题控制器。 */
  nativeTheme: NativeThemeApi
  /** 获取当前应用创建的全部窗口。 */
  getWindows(): readonly AppearanceWindow[]
  /** 将已净化的外观状态发送给所有 renderer。 */
  onChanged(state: DesktopAppearanceState): void
}

const LIGHT_WINDOW_BACKGROUND = '#f5f7fb'
const DARK_WINDOW_BACKGROUND = '#111827'

function isThemeChoice(value: unknown): value is DesktopThemeChoice {
  return value === 'auto' || value === 'light' || value === 'dark'
}

/** 管理 Electron 原生标题栏、窗口底色与系统主题变化。 */
export class DesktopAppearanceService {
  private choice: DesktopThemeChoice = 'auto'
  private readonly handleNativeThemeUpdate = (): void => {
    this.broadcastCurrent()
  }

  /** 创建外观服务。 */
  public constructor(private readonly options: DesktopAppearanceOptions) {}

  /** 开始监听系统主题变化，并同步所有已创建窗口。 */
  public start(): void {
    this.options.nativeTheme.on('updated', this.handleNativeThemeUpdate)
    this.broadcastCurrent()
  }

  /** 读取当前可安全公开给 renderer 的外观状态。 */
  public get(): DesktopAppearanceState {
    return { choice: this.choice, resolved: this.resolveTheme() }
  }

  /** 应用并广播用户选择的主题来源。 */
  public apply(choice: DesktopThemeChoice): DesktopAppearanceState {
    if (!isThemeChoice(choice)) throw new Error('APPEARANCE_INVALID')
    this.choice = choice
    this.options.nativeTheme.themeSource = choice === 'auto' ? 'system' : choice
    return this.broadcastCurrent()
  }

  /** 停止监听原生主题，供应用退出时释放资源。 */
  public dispose(): void {
    this.options.nativeTheme.removeListener('updated', this.handleNativeThemeUpdate)
  }

  private resolveTheme(): 'light' | 'dark' {
    return this.options.nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  /** 将新建窗口同步至当前原生主题，避免展示白色首帧。 */
  public applyToWindow(window: AppearanceWindow): void {
    if (window.isDestroyed()) return
    window.setBackgroundColor(
      this.resolveTheme() === 'dark' ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND
    )
  }

  private broadcastCurrent(): DesktopAppearanceState {
    const state = this.get()
    const backgroundColor =
      state.resolved === 'dark' ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND
    for (const window of this.options.getWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(backgroundColor)
    }
    this.options.onChanged(state)
    return state
  }
}
