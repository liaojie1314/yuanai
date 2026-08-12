import { BellRing, MessageSquareText, Volume2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { DesktopPreferences } from '../../../shared/ipc-contract'

import '../../shared/i18n'

/** 通知分区属性。 */
export interface NotificationSectionProps {
  /** 当前桌面偏好。 */
  preferences: DesktopPreferences
  /** 保存桌面偏好。 */
  onPreferencesChanged(patch: Partial<DesktopPreferences>): Promise<void>
}

/** 管理桌面原生通知相关开关。 */
export function NotificationSection({
  preferences,
  onPreferencesChanged,
}: NotificationSectionProps): ReactElement {
  const { t } = useTranslation()
  const rows = [
    [
      'nativeNotifications',
      t('desktop.notifications.native'),
      t('desktop.notifications.nativeDescription'),
      BellRing,
    ],
    [
      'notificationSound',
      t('desktop.notifications.sound'),
      t('desktop.notifications.soundDescription'),
      Volume2,
    ],
    [
      'aiReplyNotifications',
      t('desktop.notifications.reply'),
      t('desktop.notifications.replyDescription'),
      MessageSquareText,
    ],
  ] as const

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('settings.sections.notifications')}</h2>
        <p>{t('desktop.notifications.description')}</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>{t('desktop.notifications.native')}</h3>
          {rows.map(([key, label, description, Icon]) => (
            <div className="settings-row" key={key}>
              <div>
                <strong>
                  <Icon size={16} aria-hidden="true" /> {label}
                </strong>
                <p>{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={label}
                aria-checked={preferences[key]}
                className={preferences[key] ? 'settings-switch is-on' : 'settings-switch'}
                onClick={() => void onPreferencesChanged({ [key]: !preferences[key] })}
              />
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
