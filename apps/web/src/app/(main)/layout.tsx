import type { JSX } from 'react'
import './chat.css'
import './settings.css'

export default function MainLayout({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  return <>{children}</>
}
