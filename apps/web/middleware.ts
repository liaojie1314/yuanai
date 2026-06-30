import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** 不需要登录即可访问的路径前缀 */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password']

/**
 * Next.js Edge 中间件 — 认证守卫
 *
 * 逻辑：
 * 1. PUBLIC_PATHS 中的路径直接放行
 * 2. 其余路径检查 `yuanai-auth` cookie（由登录页成功后写入）
 * 3. 无 cookie → 重定向到 `/login?from=<原路径>`，登录后可跳回
 *
 * Cookie 由客户端在登录成功后通过 `document.cookie` 写入，
 * 后端接入后应改为 `Set-Cookie` 响应头（HttpOnly + Secure）。
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const auth = request.cookies.get('yuanai-auth')
  if (!auth?.value) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  /** 排除静态资源、Next.js 内部路由和图标，其余路径均经过此中间件 */
  matcher: ['/((?!api|_next/static|_next/image|icons|favicon\\.ico).*)'],
}
