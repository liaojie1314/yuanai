import type { Metadata } from 'next'
import type { JSX } from 'react'

export const metadata: Metadata = {
  title: '元AI',
  description: '多端 AI 聊天助手',
}

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
