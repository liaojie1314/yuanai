import type { JSX } from 'react'
import './chat.css'

export default function MainLayout({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  return <>{children}</>
}
