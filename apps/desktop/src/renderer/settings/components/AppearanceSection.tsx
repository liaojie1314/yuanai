import { Monitor, Moon, Sun } from 'lucide-react'
import type { ReactElement } from 'react'

import type { UserPreferences } from '@yuanai/core/api'

/** 外观分区属性。 */
export interface AppearanceSectionProps {
  /** 当前的服务器偏好。 */
  preferences: UserPreferences
  /** 保存偏好改动。 */
  onPreferencesChanged(patch: Partial<UserPreferences>): Promise<void>
}

function applyTheme(theme: UserPreferences['theme']): void {
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

/** 修改主题、字号和内容密度。 */
export function AppearanceSection({
  preferences,
  onPreferencesChanged,
}: AppearanceSectionProps): ReactElement {
  function changeTheme(theme: UserPreferences['theme']): void {
    applyTheme(theme)
    void onPreferencesChanged({ theme })
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>外观与主题</h2>
        <p>调整桌面窗口的阅读与排版体验。</p>
      </div>
      <section className="settings-block">
        <h3>主题</h3>
        <div className="settings-choice-grid" role="radiogroup" aria-label="主题">
          {[
            { icon: Monitor, label: '跟随系统', value: 'auto' },
            { icon: Sun, label: '浅色', value: 'light' },
            { icon: Moon, label: '深色', value: 'dark' },
          ].map(({ icon: Icon, label, value }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={preferences.theme === value}
              className={preferences.theme === value ? 'is-selected' : undefined}
              onClick={() => changeTheme(value as UserPreferences['theme'])}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-block">
        <h3>字体大小</h3>
        <label className="settings-range">
          <span>字体大小</span>
          <input
            aria-label="字体大小"
            type="range"
            min="0"
            max="2"
            step="1"
            value={['small', 'medium', 'large'].indexOf(preferences.fontSize)}
            onChange={(event) => {
              const next = ['small', 'medium', 'large'][Number(event.target.value)] as
                UserPreferences['fontSize'] | undefined
              if (next) void onPreferencesChanged({ fontSize: next })
            }}
          />
          <output>
            {preferences.fontSize === 'small'
              ? '小'
              : preferences.fontSize === 'large'
                ? '大'
                : '标准'}
          </output>
        </label>
      </section>
      <section className="settings-block">
        <h3>内容密度</h3>
        <div className="settings-segmented" role="radiogroup" aria-label="内容密度">
          {(
            [
              ['compact', '紧凑'],
              ['standard', '标准'],
              ['loose', '宽松'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={preferences.density === value}
              className={preferences.density === value ? 'is-selected' : undefined}
              onClick={() => void onPreferencesChanged({ density: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
