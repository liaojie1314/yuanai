'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Bot } from 'lucide-react'
import type { Assistant } from '@yuanai/types'
import { useTranslations } from '@/i18n/client'

interface AssistantSwitcherProps {
  /** 当前用户的全部助理 */
  assistants: readonly Assistant[]
  /** 会话已绑定的助理；`null` 表示未绑定，按后端顺序回落到默认助理 */
  activeAssistantId: string | null
  /**
   * 选了另一个助理，由调用方负责把会话绑过去。
   * 省略表示当前没有可绑定的会话，此时只显示标签 —— 点了没反应的控件比没有控件更糟。
   */
  onSelect?: (assistantId: string) => void
}

/**
 * 侧栏里的当前助理标签与切换器。
 *
 * 只有一个助理时不渲染切换控件：唯一选项的下拉框是纯噪音。
 */
export function AssistantSwitcher({
  assistants,
  activeAssistantId,
  onSelect,
}: AssistantSwitcherProps): JSX.Element | null {
  const t = useTranslations('chat.assistant')
  if (assistants.length === 0) return null
  // 与后端解析默认助理的顺序一致：先看会话绑定，再看 isDefault，最后退回第一个
  const active =
    assistants.find((item) => item.id === activeAssistantId) ??
    assistants.find((item) => item.isDefault) ??
    assistants[0]
  if (!active) return null

  return (
    <div className="ch-sb-assistant">
      <Bot aria-hidden="true" size={14} />
      {assistants.length > 1 && onSelect ? (
        <select
          aria-label={t('switch')}
          onChange={(event) => {
            if (event.target.value !== active.id) onSelect(event.target.value)
          }}
          value={active.id}
        >
          {assistants.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="ch-sb-assistant-name" title={t('current')}>
          {active.name}
        </span>
      )}
      <Link className="ch-sb-assistant-manage" href="/agent/assistants">
        {t('manage')}
      </Link>
    </div>
  )
}
