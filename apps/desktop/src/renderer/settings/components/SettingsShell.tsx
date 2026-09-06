import {
  Bell,
  CircleHelp,
  Globe2,
  MonitorCog,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'

/** 设置页面的固定分区标识。 */
export type SettingsSectionId =
  'profile' | 'security' | 'appearance' | 'notifications' | 'language' | 'desktop' | 'about'

/** 设置导航项。 */
export interface SettingsNavigationItem {
  /** 分区标识。 */
  id: SettingsSectionId
  /** 分区名称的翻译键。 */
  labelKey: string
  /** 设置导航所属分组。 */
  group: 'account' | 'application' | 'support'
  /** 导航图标。 */
  icon: LucideIcon
}

/** 设置壳层属性。 */
export interface SettingsShellProps {
  /** 当前选中的分区。 */
  activeSection: SettingsSectionId
  /** 分区切换回调。 */
  onSectionChange(section: SettingsSectionId): void
  /** 当前分区内容。 */
  children: ReactNode
}

/** 提供可键盘导航的七分区设置壳层。 */
export function SettingsShell({
  activeSection,
  onSectionChange,
  children,
}: SettingsShellProps): ReactElement {
  const { t } = useTranslation()
  const buttonRefs = useRef(new Map<SettingsSectionId, HTMLButtonElement>())
  const [appVersion, setAppVersion] = useState('')
  const items = SETTINGS_ITEMS.map((item) => ({ ...item, label: t(item.labelKey) }))

  useEffect(() => {
    let cancelled = false
    window.yuanai.system
      .getInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.version)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function selectSection(section: SettingsSectionId): void {
    onSectionChange(section)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = items.findIndex((item) => item.id === activeSection)
    if (index < 0) return
    let nextIndex = index
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
      nextIndex = (index + 1) % items.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + items.length) % items.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex === index) return
    event.preventDefault()
    const next = items[nextIndex]
    if (!next) return
    selectSection(next.id)
    buttonRefs.current.get(next.id)?.focus()
  }

  return (
    <main className="desktop-settings" aria-label={`${t('common.appName')} ${t('settings.title')}`}>
      <nav className="desktop-settings__nav" aria-label={t('settings.title')}>
        <div className="desktop-settings__nav-header">
          <h1>{t('settings.title')}</h1>
        </div>
        <div
          className="desktop-settings__nav-body"
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={handleKeyDown}
        >
          {SETTINGS_GROUPS.map(({ id, labelKey }) => (
            <div key={id} className="desktop-settings__nav-group">
              <p>{t(labelKey)}</p>
              {items
                .filter((item) => item.group === id)
                .map((item) => {
                  const Icon = item.icon
                  const selected = item.id === activeSection
                  return (
                    <button
                      key={item.id}
                      ref={(element) => {
                        if (element) buttonRefs.current.set(item.id, element)
                        else buttonRefs.current.delete(item.id)
                      }}
                      id={`settings-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-controls={`settings-panel-${item.id}`}
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      className={selected ? 'is-active' : undefined}
                      onClick={() => selectSection(item.id)}
                    >
                      <Icon aria-hidden="true" size={16} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
            </div>
          ))}
        </div>
        <p className="desktop-settings__nav-footer">
          {appVersion ? `${t('common.appName')} v${appVersion}` : t('common.appName')}
        </p>
      </nav>
      <header className="desktop-settings__mobile-header">
        <h1>{t('settings.title')}</h1>
        <label className="desktop-settings__mobile-select">
          <span>{t('settings.title')}</span>
          <select
            value={activeSection}
            onChange={(event) => selectSection(event.target.value as SettingsSectionId)}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <section
        id={`settings-panel-${activeSection}`}
        className="desktop-settings__content"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeSection}`}
      >
        {children}
      </section>
    </main>
  )
}

const SETTINGS_ITEMS: readonly SettingsNavigationItem[] = [
  { id: 'profile', labelKey: 'settings.sections.profile', group: 'account', icon: UserRound },
  { id: 'security', labelKey: 'settings.sections.security', group: 'account', icon: ShieldCheck },
  {
    id: 'appearance',
    labelKey: 'settings.sections.appearance',
    group: 'application',
    icon: Palette,
  },
  {
    id: 'notifications',
    labelKey: 'settings.sections.notifications',
    group: 'application',
    icon: Bell,
  },
  { id: 'language', labelKey: 'settings.sections.language', group: 'application', icon: Globe2 },
  { id: 'desktop', labelKey: 'desktop.settings.desktop', group: 'application', icon: MonitorCog },
  { id: 'about', labelKey: 'settings.sections.about', group: 'support', icon: CircleHelp },
]

const SETTINGS_GROUPS = [
  { id: 'account', labelKey: 'desktop.settings.account' },
  { id: 'application', labelKey: 'desktop.settings.application' },
  { id: 'support', labelKey: 'desktop.settings.support' },
] as const
