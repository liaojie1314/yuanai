import { BookOpen, ExternalLink, Github, HeartHandshake, ShieldCheck } from 'lucide-react'
import type { ReactElement } from 'react'

import type { DesktopAppInfo, ExternalLinkId } from '../../../shared/ipc-contract'

/** 关于与帮助分区属性。 */
export interface AboutSectionProps {
  /** 应用运行信息。 */
  appInfo: DesktopAppInfo | undefined
  /** 通过主进程打开固定帮助链接。 */
  onOpenExternal(link: ExternalLinkId): Promise<void>
}

/** 展示版本信息和受控的帮助入口。 */
export function AboutSection({ appInfo, onOpenExternal }: AboutSectionProps): ReactElement {
  const links = [
    ['documentation', '使用文档', BookOpen],
    ['repository', '项目仓库', Github],
    ['feedback', '反馈问题', HeartHandshake],
    ['privacy', '隐私政策', ShieldCheck],
  ] as const
  return (
    <div className="settings-section">
      <div className="settings-section__heading">
        <h2>关于与帮助</h2>
        <p>元AI 桌面端的版本与支持信息。</p>
      </div>
      <section className="settings-block settings-about">
        <div className="settings-about__mark">元</div>
        <div>
          <h3>元AI</h3>
          <p>
            v{appInfo?.version ?? '--'} · {appInfo?.platform ?? 'desktop'}
          </p>
        </div>
      </section>
      <section className="settings-block">
        <h3>帮助与支持</h3>
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
  )
}
