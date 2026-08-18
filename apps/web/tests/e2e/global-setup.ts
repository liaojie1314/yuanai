import type { FullConfig } from '@playwright/test'

/**
 * 在 E2E 用例开始前预热受认证保护的聊天页面。
 * Next.js 开发服务器会按路由懒编译；在 CI 冷启动时首次编译 /chat 可能超过登录用例的导航等待，
 * 导致首个聊天用例失败、重试成功。使用测试 cookie 绕过中间件并等待完整响应，确保测试只验证业务行为。
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000'
  const response = await fetch(`${baseURL}/chat`, {
    headers: { Cookie: 'yuanai-auth=playwright-prewarm' },
  })

  if (!response.ok) {
    throw new Error(`E2E chat page prewarm failed with HTTP ${response.status}`)
  }
}
