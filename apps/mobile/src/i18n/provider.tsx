import { type ReactNode, useEffect, useState } from 'react'

import { initI18n } from './index'

/**
 * 应用启动前完成 i18next 初始化；同步 API 就绪后再渲染子树，
 * 避免 React 组件先渲染再吞掉「资源未就绪」的报错。
 */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void initI18n().finally(() => setReady(true))
  }, [])
  if (!ready) return null
  return children
}
