'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useTranslations } from '@/i18n/client'

/**
 * `/agent/*` 页面左上角的返回聊天入口。
 *
 * 固定返回 `/chat` 而不是 `router.back()`：这些页面之间也会互相跳，
 * 后退一步常常只是回到另一个管理页，而用户想回的是对话。
 */
export default function BackToChat(): JSX.Element {
  const t = useTranslations('common')
  return (
    <div className="agent-backbar">
      <Link className="agent-back" href="/chat">
        <ArrowLeft aria-hidden="true" size={15} />
        <span>{t('backToChat')}</span>
      </Link>
    </div>
  )
}
