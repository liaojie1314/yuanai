import type { ReactElement } from 'react'

/** Artifact 预览窗口的基础界面。 */
export function App(): ReactElement {
  return (
    <main aria-label="Artifact 预览" tabIndex={-1}>
      <h1>Artifact 预览</h1>
      <p>预览内容正在准备中。</p>
    </main>
  )
}
