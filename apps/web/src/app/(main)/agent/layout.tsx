import type { JSX } from 'react'
import BackToChat from '@/components/agent/BackToChat'

/**
 * `/agent/*` 各页面的公共外壳。
 *
 * 这些页面都是从聊天界面跳进来的独立路由，自己不带任何导航，
 * 进来之后只能按浏览器后退键 —— 桌面端壳里根本没有后退键。
 * 返回入口放在这一层而不是各个中心组件里：八个页面都缺，缺的是外壳不是组件。
 */
export default function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  return (
    <>
      <BackToChat />
      {children}
    </>
  )
}
