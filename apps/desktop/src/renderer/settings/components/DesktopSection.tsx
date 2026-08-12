import { Check, ChevronDown, Keyboard, MonitorDown, Power, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { DesktopPreferences } from '../../../shared/ipc-contract'

import '../../shared/i18n'

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

function shortcutKey(event: KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key === 'Escape') return null
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return ''
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5)
  if (/^F\d{1,2}$/.test(event.code)) return event.code
  const specialKeys: Readonly<Record<string, string>> = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Spacebar: 'Space',
    ' ': 'Space',
    Tab: 'Tab',
  }
  return specialKeys[event.key] ?? null
}

function captureShortcut(event: KeyboardEvent<HTMLInputElement>): string | null {
  const key = shortcutKey(event)
  if (key === null || key === '') return key
  const modifiers = [
    ...(event.ctrlKey || event.metaKey ? ['CommandOrControl'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
  ]
  if (modifiers.length === 0 && !/^F\d{1,2}$/.test(key)) return ''
  return [...modifiers, key].join('+')
}

/** 管理 Electron 原生窗口、快捷键和更新偏好。 */
export function DesktopSection({
  preferences,
  onPreferencesChanged,
  onAutoLaunchChanged,
  onShortcutApplied,
}: DesktopSectionProps): ReactElement {
  const { t } = useTranslation()
  const [shortcut, setShortcut] = useState(preferences.globalShortcut ?? '')
  const [shortcutError, setShortcutError] = useState('')
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const [isUpdateMenuOpen, setIsUpdateMenuOpen] = useState(false)
  const updateMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setShortcut(preferences.globalShortcut ?? ''), [preferences.globalShortcut])

  useEffect(() => {
    if (!isUpdateMenuOpen) return
    function closeOnPointerDown(event: MouseEvent): void {
      if (event.target instanceof Node && updateMenuRef.current?.contains(event.target)) return
      setIsUpdateMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnPointerDown)
    return () => document.removeEventListener('mousedown', closeOnPointerDown)
  }, [isUpdateMenuOpen])

  async function applyShortcut(): Promise<void> {
    setShortcutError('')
    try {
      const status = await window.yuanai.system.setGlobalShortcut(shortcut.trim() || null)
      setShortcut(status.accelerator ?? '')
      if (status.errorCode === 'CONFLICT') {
        setShortcutError(t('desktop.settings.shortcutConflict'))
        return
      }
      if (status.errorCode === 'INVALID') {
        setShortcutError(t('desktop.settings.shortcutInvalid'))
        return
      }
      onShortcutApplied(status.accelerator)
    } catch {
      setShortcut(preferences.globalShortcut ?? '')
      setShortcutError(t('desktop.settings.shortcutApplyFailed'))
    }
  }

  async function setAutoLaunch(enabled: boolean): Promise<void> {
    try {
      onAutoLaunchChanged(await window.yuanai.system.setAutoLaunch(enabled))
    } catch {
      setShortcutError(t('desktop.settings.autoLaunchFailed'))
    }
  }

  function handleShortcutKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!isRecordingShortcut) return
    event.preventDefault()
    const recordedShortcut = captureShortcut(event)
    if (recordedShortcut === null) {
      setIsRecordingShortcut(false)
      return
    }
    if (!recordedShortcut) return
    setShortcut(recordedShortcut)
    setShortcutError('')
    setIsRecordingShortcut(false)
  }

  function handleShortcutBlur(): void {
    setIsRecordingShortcut(false)
  }

  function handleUpdateChannelKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Escape') {
      setIsUpdateMenuOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIsUpdateMenuOpen((value) => !value)
    }
  }

  function selectUpdateChannel(channel: DesktopPreferences['updateChannel']): void {
    setIsUpdateMenuOpen(false)
    if (channel !== preferences.updateChannel) void onPreferencesChanged({ updateChannel: channel })
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('desktop.settings.desktop')}</h2>
        <p>{t('desktop.settings.desktopDescription')}</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>{t('desktop.settings.windowBehavior')}</h3>
          <div className="settings-row">
            <div>
              <strong>
                <MonitorDown size={16} aria-hidden="true" /> {t('desktop.settings.closeToTray')}
              </strong>
              <p>{t('desktop.settings.closeToTrayDescription')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t('desktop.settings.closeToTray')}
              aria-checked={preferences.closeToTray}
              className={preferences.closeToTray ? 'settings-switch is-on' : 'settings-switch'}
              onClick={() => void onPreferencesChanged({ closeToTray: !preferences.closeToTray })}
            />
          </div>
        </section>
        <section className="settings-block">
          <h3>{t('desktop.settings.globalShortcut')}</h3>
          <label className="settings-field">
            <span>
              <Keyboard size={16} aria-hidden="true" /> {t('desktop.settings.globalInvokeShortcut')}
            </span>
            <div className="settings-inline-field">
              <input
                value={shortcut}
                readOnly
                maxLength={128}
                aria-label={t('desktop.settings.globalInvokeShortcut')}
                aria-describedby="desktop-shortcut-help"
                placeholder={t('desktop.settings.recordingShortcut')}
                onFocus={() => setIsRecordingShortcut(true)}
                onBlur={handleShortcutBlur}
                onKeyDown={handleShortcutKeyDown}
              />
              <button
                type="button"
                className={
                  isRecordingShortcut ? 'settings-icon-button is-recording' : 'settings-icon-button'
                }
                aria-label={t('desktop.settings.recordShortcut')}
                title={t('desktop.settings.recordShortcut')}
                onClick={() => setIsRecordingShortcut((value) => !value)}
              >
                <Keyboard size={15} aria-hidden="true" />
              </button>
              {shortcut ? (
                <button
                  type="button"
                  className="settings-icon-button"
                  aria-label={t('desktop.settings.clearShortcut')}
                  title={t('desktop.settings.clearShortcut')}
                  onClick={() => {
                    setShortcut('')
                    setShortcutError('')
                  }}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="settings-button settings-button--secondary"
                onClick={() => void applyShortcut()}
              >
                {t('desktop.settings.applyShortcut')}
              </button>
            </div>
          </label>
          <p id="desktop-shortcut-help" className="settings-field-hint">
            {isRecordingShortcut
              ? t('desktop.settings.recordingShortcut')
              : t('desktop.settings.globalShortcutDescription')}
          </p>
          {shortcutError ? (
            <p className="settings-alert" role="alert">
              {shortcutError}
            </p>
          ) : null}
        </section>
        <section className="settings-block">
          <h3>{t('desktop.settings.startupAndUpdates')}</h3>
          <div className="settings-row">
            <div>
              <strong>
                <Power size={16} aria-hidden="true" /> {t('desktop.settings.autoLaunch')}
              </strong>
              <p>{t('desktop.settings.autoLaunchDescription')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t('desktop.settings.autoLaunch')}
              aria-checked={preferences.autoLaunch}
              className={preferences.autoLaunch ? 'settings-switch is-on' : 'settings-switch'}
              onClick={() => void setAutoLaunch(!preferences.autoLaunch)}
            />
          </div>
          <div className="settings-field">
            <span>
              <RefreshCw size={16} aria-hidden="true" /> {t('desktop.settings.updateChannel')}
            </span>
            <div className="settings-select" ref={updateMenuRef}>
              <button
                type="button"
                role="combobox"
                aria-label={t('desktop.settings.updateChannel')}
                aria-controls="desktop-update-channel-options"
                aria-expanded={isUpdateMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setIsUpdateMenuOpen((value) => !value)}
                onKeyDown={handleUpdateChannelKeyDown}
              >
                <span>
                  {preferences.updateChannel === 'stable'
                    ? t('desktop.settings.stable')
                    : t('desktop.settings.beta')}
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {isUpdateMenuOpen ? (
                <div id="desktop-update-channel-options" role="listbox">
                  {(['stable', 'beta'] as const).map((channel) => {
                    const selected = preferences.updateChannel === channel
                    return (
                      <button
                        key={channel}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => selectUpdateChannel(channel)}
                      >
                        <span>{t(`desktop.settings.${channel}`)}</span>
                        {selected ? <Check size={15} aria-hidden="true" /> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t('desktop.settings.autoUpdate')}</strong>
              <p>{t('desktop.settings.autoUpdateDescription')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t('desktop.settings.autoUpdate')}
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
