import { Monitor, Moon, Sun } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { UserPreferences } from '@yuanai/core/api'

import '../../shared/i18n'

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
  const { t } = useTranslation()
  function changeTheme(theme: UserPreferences['theme']): void {
    applyTheme(theme)
    void onPreferencesChanged({ theme }).catch(() => undefined)
  }

  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('settings.sections.appearance')}</h2>
        <p>{t('desktop.appearance.description')}</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block">
          <h3>{t('settings.appearance.theme')}</h3>
          <div
            className="settings-choice-grid"
            role="radiogroup"
            aria-label={t('settings.appearance.theme')}
          >
            {[
              { icon: Monitor, label: t('settings.appearance.themeAuto'), value: 'auto' },
              { icon: Sun, label: t('settings.appearance.themeLight'), value: 'light' },
              { icon: Moon, label: t('settings.appearance.themeDark'), value: 'dark' },
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
          <h3>{t('settings.appearance.fontSize')}</h3>
          <label className="settings-range">
            <span>{t('settings.appearance.fontSize')}</span>
            <input
              aria-label={t('settings.appearance.fontSize')}
              type="range"
              min="0"
              max="2"
              step="1"
              value={['small', 'medium', 'large'].indexOf(preferences.fontSize)}
              onChange={(event) => {
                const next = ['small', 'medium', 'large'][Number(event.target.value)] as
                  UserPreferences['fontSize'] | undefined
                if (next) void onPreferencesChanged({ fontSize: next }).catch(() => undefined)
              }}
            />
            <output>
              {preferences.fontSize === 'small'
                ? t('settings.appearance.fontSmall')
                : preferences.fontSize === 'large'
                  ? t('settings.appearance.fontLarge')
                  : t('settings.appearance.fontMedium')}
            </output>
          </label>
        </section>
        <section className="settings-block">
          <h3>{t('settings.appearance.density')}</h3>
          <div
            className="settings-segmented"
            role="radiogroup"
            aria-label={t('settings.appearance.density')}
          >
            {(
              [
                ['compact', t('settings.appearance.densityCompact')],
                ['standard', t('settings.appearance.densityStandard')],
                ['loose', t('settings.appearance.densityLoose')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.density === value}
                className={preferences.density === value ? 'is-selected' : undefined}
                onClick={() => void onPreferencesChanged({ density: value }).catch(() => undefined)}
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
