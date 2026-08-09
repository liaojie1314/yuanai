import type { ReactElement } from 'react'

/** OAuth 中转窗口的基础界面。 */
export function App(): ReactElement {
  return (
    <main aria-label="正在完成登录" tabIndex={-1}>
      <h1>正在完成登录</h1>
      <p role="status">请稍候。</p>
    </main>
  )
}
