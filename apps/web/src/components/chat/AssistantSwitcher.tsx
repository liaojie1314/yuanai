'use client'

import { useState, type JSX } from 'react'
import Link from 'next/link'
import { Bot, Check, ChevronDown, Settings2 } from 'lucide-react'
import type { Assistant } from '@yuanai/types'
import { useTranslations } from '@/i18n/client'

interface AssistantSwitcherProps {
  /** 当前用户的全部助理 */
  assistants: readonly Assistant[]
  /** 会话已绑定的助理；`null` 表示未绑定，按后端顺序回落到默认助理 */
  activeAssistantId: string | null
  /**
   * 选了另一个助理，由调用方负责落库：已有会话走 PATCH，空态屏先记住、建会话时带上。
   * 所以这里不接受「不可绑定」的情况 —— 空态屏也必须能选。
   */
  onSelect: (assistantId: string) => void
}

/**
 * 会话头部的当前助理标签与切换器，紧挨模型选择器。
 *
 * 位置和控件都跟着模型选择器走：原先挂在侧栏搜索框下面，展开的面板压在会话列表上，
 * 三端里只有 Web 把它塞进侧栏，欢迎页更是整条都看不见。
 * 只有一个助理时也照样能点开 —— 面板底部的「管理助理」是全站唯一的助理增删改入口，
 * 退化成纯文字标签会把新用户堵死在默认助理上。
 */
export function AssistantSwitcher({
  assistants,
  activeAssistantId,
  onSelect,
}: AssistantSwitcherProps): JSX.Element | null {
  const t = useTranslations('chat.assistant')
  const [isOpen, setIsOpen] = useState(false)
  if (assistants.length === 0) return null
  // 与后端解析默认助理的顺序一致：先看会话绑定，再看 isDefault，最后退回第一个
  const active =
    assistants.find((item) => item.id === activeAssistantId) ??
    assistants.find((item) => item.isDefault) ??
    assistants[0]
  if (!active) return null

  return (
    <div className="ch-asw">
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={t('switch')}
        className="ch-asw-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Bot aria-hidden="true" size={14} />
        <span className="ch-asw-name">{active.name}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {isOpen ? (
        <>
          {/* 点面板外关闭：遮罩盖住整屏，层级压在面板之下 */}
          <div className="ch-asw-dismiss" onClick={() => setIsOpen(false)} />
          <div className="ch-asw-drop" role="listbox">
            <div className="ch-asw-list">
              {assistants.map((item) => {
                const selected = item.id === active.id
                return (
                  <button
                    aria-selected={selected}
                    className={`ch-asw-opt ${selected ? 'sel' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setIsOpen(false)
                      // 选回当前助理不必白跑一次 PATCH
                      if (!selected) onSelect(item.id)
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="ch-asw-opt-name">{item.name}</span>
                    {selected ? <Check aria-hidden="true" size={14} /> : null}
                  </button>
                )
              })}
            </div>
            <Link className="ch-asw-manage" href="/agent/assistants">
              <Settings2 aria-hidden="true" size={13} />
              <span>{t('manage')}</span>
            </Link>
          </div>
        </>
      ) : null}
    </div>
  )
}
