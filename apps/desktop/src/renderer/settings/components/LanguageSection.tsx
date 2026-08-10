import { CalendarDays, Clock3, Languages } from 'lucide-react'
import type { ReactElement } from 'react'

import type { UserPreferences } from '@yuanai/core/api'

/** 语言与地区分区属性。 */
export interface LanguageSectionProps {
  /** 当前服务器偏好。 */
  preferences: UserPreferences
  /** 保存偏好改动。 */
  onPreferencesChanged(patch: Partial<UserPreferences>): Promise<void>
}

/** 修改界面语言、时间和日期显示格式。 */
export function LanguageSection({
  preferences,
  onPreferencesChanged,
}: LanguageSectionProps): ReactElement {
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>语言与地区</h2>
        <p>选择界面语言和本地时间格式。</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>
            <Languages size={17} aria-hidden="true" /> 界面语言
          </h3>
          <div
            className="settings-choice-grid settings-choice-grid--two"
            role="radiogroup"
            aria-label="界面语言"
          >
            {(
              [
                ['zh-CN', '简体中文'],
                ['en', 'English'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.language === value}
                className={preferences.language === value ? 'is-selected' : undefined}
                onClick={() => void onPreferencesChanged({ language: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-block">
          <h3>
            <Clock3 size={17} aria-hidden="true" /> 时间格式
          </h3>
          <div className="settings-segmented" role="radiogroup" aria-label="时间格式">
            {(
              [
                ['24h', '24 小时'],
                ['12h', '12 小时'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.timeFormat === value}
                className={preferences.timeFormat === value ? 'is-selected' : undefined}
                onClick={() => void onPreferencesChanged({ timeFormat: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-block">
          <h3>
            <CalendarDays size={17} aria-hidden="true" /> 日期格式
          </h3>
          <div className="settings-segmented" role="radiogroup" aria-label="日期格式">
            {(
              [
                ['ymd', '2026-08-10'],
                ['mdy', '08/10/2026'],
                ['dmy', '10/08/2026'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.dateFormat === value}
                className={preferences.dateFormat === value ? 'is-selected' : undefined}
                onClick={() => void onPreferencesChanged({ dateFormat: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
