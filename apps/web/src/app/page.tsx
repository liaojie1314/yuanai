import { redirect } from 'next/navigation'

/**
 * 根路由 `/` → 重定向到 `/login`
 * 待 Phase 2 完整实现后，登录态检测将在此处处理
 */
export default function HomePage(): never {
  redirect('/login')
}
