import type { JSX } from 'react'
import './auth.css'

/** Auth 路由组布局 — 引入 auth 公共样式 */
export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  return <>{children}</>
}
