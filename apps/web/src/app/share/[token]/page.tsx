import type { JSX } from 'react'
import { use } from 'react'
import SharedConversationView from './SharedConversationView'

/**
 * 只读会话分享页
 *
 * 匿名可访问，通过分享 token 展示原对话完整消息。
 * 页面不进入 `(main)` 分组，不加载 chat.css 大样式；使用轻量样式即可。
 */
export default function SharePage({ params }: { params: Promise<{ token: string }> }): JSX.Element {
  const { token } = use(params)
  return <SharedConversationView token={token} />
}
