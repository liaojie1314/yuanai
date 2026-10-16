import { Bot, Check, ChevronDown } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import type { Assistant } from '@yuanai/types'

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
 * 会话头部的当前助理标签与切换器。
 *
 * 选单复用模型选择器的 `role="listbox"` 面板与 `desktop-chat__model-dismiss` 遮罩：
 * 同一条头部里两个同类选择器用两种控件（原生 `select` vs 自绘面板）会让人以为是两种功能。
 * 桌面端本轮只做标签与切换，助理增删改与人格编辑器仍只在 Web 端。
 * 只有一个助理时不渲染切换控件：唯一选项的下拉框是纯噪音。
 */
export function AssistantSwitcher({
  assistants,
  activeAssistantId,
  onSelect,
}: AssistantSwitcherProps): ReactElement | null {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  if (assistants.length === 0) return null
  // 与后端解析默认助理的顺序一致：先看会话绑定，再看 isDefault，最后退回第一个
  const active =
    assistants.find((item) => item.id === activeAssistantId) ??
    assistants.find((item) => item.isDefault) ??
    assistants[0]
  if (!active) return null
  const canSwitch = assistants.length > 1

  return (
    <div className="desktop-chat__assistant">
      <Bot size={15} aria-hidden="true" />
      {canSwitch ? (
        <>
          <button
            className="desktop-chat__assistant-trigger"
            type="button"
            aria-label={t('chat.assistant.switch')}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            onClick={() => setIsOpen((open) => !open)}
          >
            <span className="desktop-chat__assistant-name">{active.name}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {isOpen ? (
            <>
              <button
                className="desktop-chat__model-dismiss"
                type="button"
                aria-label={t('chat.assistant.close')}
                onClick={() => setIsOpen(false)}
              />
              <div className="desktop-chat__assistant-menu" role="listbox">
                {assistants.map((item) => {
                  const selected = item.id === active.id
                  return (
                    <button
                      key={item.id}
                      className={selected ? 'is-selected' : undefined}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setIsOpen(false)
                        // 选回当前助理不必白跑一次 PATCH
                        if (!selected) onSelect(item.id)
                      }}
                    >
                      <span className="desktop-chat__assistant-menu-copy">{item.name}</span>
                      {selected ? <Check size={16} aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <span className="desktop-chat__assistant-name" title={t('chat.assistant.current')}>
          {active.name}
        </span>
      )}
    </div>
  )
}
