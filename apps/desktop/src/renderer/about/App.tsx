import type { ReactElement } from 'react'

/** 关于窗口的基础界面。 */
export function App(): ReactElement {
  return (
    <main aria-label="关于元AI" tabIndex={-1}>
      <h1>关于元AI</h1>
      <p>应用信息正在准备中。</p>
    </main>
  )
}
