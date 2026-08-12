import { BookOpen, ExternalLink, Github, HeartHandshake, ShieldCheck } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { DesktopAppInfo, ExternalLinkId } from '../../../shared/ipc-contract'

import '../../shared/i18n'

/** 关于与帮助分区属性。 */
export interface AboutSectionProps {
  /** 应用运行信息。 */
  appInfo: DesktopAppInfo | undefined
  /** 通过主进程打开固定帮助链接。 */
  onOpenExternal(link: ExternalLinkId): Promise<void>
}

/** 展示版本信息和受控的帮助入口。 */
export function AboutSection({ appInfo, onOpenExternal }: AboutSectionProps): ReactElement {
  const { t } = useTranslation()
  const links = [
    ['documentation', t('settings.about.documentation'), BookOpen],
    ['repository', t('desktop.about.repository'), Github],
    ['feedback', t('desktop.about.feedback'), HeartHandshake],
    ['privacy', t('settings.about.privacyPolicy'), ShieldCheck],
  ] as const
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>{t('settings.sections.about')}</h2>
        <p>{t('desktop.about.desktopDescription')}</p>
      </div>
      <div className="settings-section__body">
        <section className="settings-block settings-about">
          <div className="settings-about__mark">元</div>
          <div>
            <h3>{t('common.appName')}</h3>
            <p>
              v{appInfo?.version ?? '--'} · {appInfo?.platform ?? 'desktop'}
            </p>
          </div>
        </section>
        <section className="settings-block">
          <h3>{t('desktop.about.help')}</h3>
          {links.map(([id, label, Icon]) => (
            <div key={id} className="settings-row">
              <div>
                <strong>
                  <Icon size={16} aria-hidden="true" /> {label}
                </strong>
              </div>
              <button
                type="button"
                className="settings-text-button"
                onClick={() => void onOpenExternal(id)}
              >
                {label}
                <ExternalLink size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
