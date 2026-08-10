import { useEffect, useState, type ReactElement } from 'react'

import type { DesktopAppInfo } from '../../shared/ipc-contract'

import { AboutSection } from '../settings/components/AboutSection'

/** 展示独立的桌面应用关于窗口。 */
export function App(): ReactElement {
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  useEffect(() => {
    void window.yuanai.system
      .getInfo()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])
  return (
    <main className="desktop-about" aria-label="关于元AI">
      <AboutSection
        appInfo={appInfo}
        onOpenExternal={(link) => window.yuanai.shell.openExternal(link)}
      />
    </main>
  )
}
