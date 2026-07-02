import type { Metadata } from 'next'
import type { JSX } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import MockProvider from '@/providers/MockProvider'
import QueryProvider from '@/providers/QueryProvider'
import { Toaster } from '@/components/Toaster'
import './globals.css'

export const metadata: Metadata = {
  title: '元AI — 智能对话助手',
  description: '多端 AI 聊天应用，支持 GPT-4o、Claude、DeepSeek 等多种模型',
}

export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode
}): Promise<JSX.Element> {
  const messages = await getMessages()

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 防止主题闪烁：在 hydration 前应用保存的主题 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){const t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t==='light')document.documentElement.setAttribute('data-theme','light');})();`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <MockProvider>
            <QueryProvider>
              {children}
              <Toaster />
            </QueryProvider>
          </MockProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
