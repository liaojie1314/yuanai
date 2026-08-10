import { BellRing, MessageSquareText, Volume2 } from 'lucide-react'
import type { ReactElement } from 'react'

import type { DesktopPreferences } from '../../../shared/ipc-contract'

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
  const rows = [
    ['nativeNotifications', '原生通知', '允许元AI使用系统通知提醒你。', BellRing],
    ['notificationSound', '通知声音', '收到系统通知时播放提示音。', Volume2],
    [
      'aiReplyNotifications',
      'AI 回复完成提醒',
      '在聊天不位于前台时提醒回复已完成。',
      MessageSquareText,
    ],
  ] as const
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>通知设置</h2>
        <p>选择桌面端如何提醒你。</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>原生通知</h3>
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
