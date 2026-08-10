import { Keyboard, MonitorDown, Power, RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

import type { DesktopPreferences } from '../../../shared/ipc-contract'

/** 桌面设置分区属性。 */
export interface DesktopSectionProps {
  /** 当前桌面偏好。 */
  preferences: DesktopPreferences
  /** 更新普通桌面偏好。 */
  onPreferencesChanged(patch: Partial<DesktopPreferences>): Promise<void>
  /** 同步系统开机自启后的完整偏好。 */
  onAutoLaunchChanged(preferences: DesktopPreferences): void
  /** 同步已经注册的全局快捷键。 */
  onShortcutApplied(accelerator: string | null): void
}

/** 管理 Electron 原生窗口、快捷键和更新偏好。 */
export function DesktopSection({
  preferences,
  onPreferencesChanged,
  onAutoLaunchChanged,
  onShortcutApplied,
}: DesktopSectionProps): ReactElement {
  const [shortcut, setShortcut] = useState(preferences.globalShortcut ?? '')
  const [shortcutError, setShortcutError] = useState('')

  useEffect(() => setShortcut(preferences.globalShortcut ?? ''), [preferences.globalShortcut])

  async function applyShortcut(): Promise<void> {
    setShortcutError('')
    try {
      const status = await window.yuanai.system.setGlobalShortcut(shortcut.trim() || null)
      setShortcut(status.accelerator ?? '')
      if (status.errorCode === 'CONFLICT') {
        setShortcutError('快捷键已被其他应用占用')
        return
      }
      if (status.errorCode === 'INVALID') {
        setShortcutError('快捷键格式无效')
        return
      }
      onShortcutApplied(status.accelerator)
    } catch {
      setShortcut(preferences.globalShortcut ?? '')
      setShortcutError('无法应用快捷键，请重试')
    }
  }

  async function setAutoLaunch(enabled: boolean): Promise<void> {
    try {
      onAutoLaunchChanged(await window.yuanai.system.setAutoLaunch(enabled))
    } catch {
      setShortcutError('无法更新开机自启设置，请重试')
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>桌面设置</h2>
        <p>配置元AI与操作系统的协作方式。</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>窗口行为</h3>
          <div className="settings-row">
            <div>
              <strong>
                <MonitorDown size={16} aria-hidden="true" /> 关闭时最小化到托盘
              </strong>
              <p>关闭主窗口后保持应用在后台运行。</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="关闭时最小化到托盘"
              aria-checked={preferences.closeToTray}
              className={preferences.closeToTray ? 'settings-switch is-on' : 'settings-switch'}
              onClick={() => void onPreferencesChanged({ closeToTray: !preferences.closeToTray })}
            />
          </div>
        </section>
        <section className="settings-block">
          <h3>全局快捷键</h3>
          <label className="settings-field">
            <span>
              <Keyboard size={16} aria-hidden="true" /> 全局唤起快捷键
            </span>
            <div className="settings-inline-field">
              <input
                value={shortcut}
                maxLength={128}
                aria-label="全局唤起快捷键"
                onChange={(event) => setShortcut(event.target.value)}
              />
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => void applyShortcut()}
              >
                应用快捷键
              </button>
            </div>
          </label>
          {shortcutError ? (
            <p className="settings-alert" role="alert">
              {shortcutError}
            </p>
          ) : null}
        </section>
        <section className="settings-block">
          <h3>启动与更新</h3>
          <div className="settings-row">
            <div>
              <strong>
                <Power size={16} aria-hidden="true" /> 开机自动启动
              </strong>
              <p>登录系统后自动启动元AI。</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="开机自动启动"
              aria-checked={preferences.autoLaunch}
              className={preferences.autoLaunch ? 'settings-switch is-on' : 'settings-switch'}
              onClick={() => void setAutoLaunch(!preferences.autoLaunch)}
            />
          </div>
          <label className="settings-field">
            <span>
              <RefreshCw size={16} aria-hidden="true" /> 更新通道
            </span>
            <select
              aria-label="更新通道"
              value={preferences.updateChannel}
              onChange={(event) =>
                void onPreferencesChanged({
                  updateChannel: event.target.value as DesktopPreferences['updateChannel'],
                })
              }
            >
              <option value="stable">稳定版</option>
              <option value="beta">测试版</option>
            </select>
          </label>
          <div className="settings-row">
            <div>
              <strong>自动检查更新</strong>
              <p>在应用启动后检查是否有可用的新版本。</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="自动检查更新"
              aria-checked={preferences.checkUpdatesAutomatically}
              className={
                preferences.checkUpdatesAutomatically ? 'settings-switch is-on' : 'settings-switch'
              }
              onClick={() =>
                void onPreferencesChanged({
                  checkUpdatesAutomatically: !preferences.checkUpdatesAutomatically,
                })
              }
            />
          </div>
        </section>
      </div>
    </div>
  )
}
