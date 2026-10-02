import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** 消息气泡的属性。 */
export interface MessageBubbleProps {
  /** 消息角色：用户消息走右侧渐变气泡，助手消息直接平铺正文。 */
  role: 'user' | 'assistant'
  /** 气泡内容，通常是纯文本或已渲染的 Markdown 节点。 */
  children: ReactNode
  /** 追加到气泡容器上的类名。 */
  className?: string
}

/**
 * 跨端共享的消息气泡，样式对应 docs/ui-spec.md「核心组件规范 / MessageBubble」。
 *
 * 助手消息刻意不加气泡背景（Claude 风格），由调用方负责正文渲染。
 */
export function MessageBubble({ role, children, className }: MessageBubbleProps) {
  if (role === 'assistant') {
    return <div className={cn('leading-7 text-[var(--text-primary)]', className)}>{children}</div>
  }

  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[75%] rounded-[18px_18px_4px_18px] px-4 py-3',
          'bg-gradient-to-br from-[var(--brand-from)] to-[var(--brand-to)]',
          'leading-6 text-white',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
