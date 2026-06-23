# Phase 2 — Web 端开发（Next.js 15）

**前置条件**: Phase 0 完成（Monorepo 搭建），Phase 1 完成（后端 API 可用）  
**分支**: `feat/phase-2-web`  
**执行范围**: `apps/web/` + `packages/ui/` + `packages/core/`（填充 stores/hooks）

---

## 目标

实现完整的 Web 端 AI 聊天界面，包括：

1. 认证页面（登录/注册）
2. 主聊天界面（侧边栏 + 消息区 + 输入框）
3. 流式消息渲染（SSE）
4. Markdown + 代码高亮
5. 多模型切换
6. 文件/图片上传
7. 明暗主题切换
8. 响应式布局（移动/平板/桌面）

---

## 路由结构（App Router）

```
apps/web/src/app/
├── layout.tsx                    ← 根布局（Provider、主题初始化）
├── page.tsx                      ← / 重定向到 /chat
├── (auth)/
│   ├── layout.tsx                ← 认证页布局（居中卡片）
│   ├── login/page.tsx            ← 登录页
│   └── register/page.tsx         ← 注册页
├── (main)/
│   ├── layout.tsx                ← 主布局（侧边栏 + 内容区）
│   ├── chat/
│   │   ├── page.tsx              ← /chat 空状态页
│   │   └── [conversationId]/
│   │       └── page.tsx          ← /chat/:id 对话页
│   └── settings/page.tsx         ← 设置页（可选，v1 可省略）
└── api/                          ← Next.js API Routes（如有需要）
```

---

## Step 1：安装依赖

```bash
cd apps/web

# UI 组件和渲染
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip \
  @radix-ui/react-scroll-area @radix-ui/react-avatar \
  react-markdown remark-gfm rehype-highlight \
  shiki \
  @tanstack/react-virtual \
  lucide-react \
  class-variance-authority clsx tailwind-merge

# 状态和请求
pnpm add @tanstack/react-query zustand axios

# 表单
pnpm add react-hook-form @hookform/resolvers zod

# 主题
pnpm add next-themes

# 内部包
pnpm add @yuanai/types@workspace:* @yuanai/core@workspace:* @yuanai/ui@workspace:*
```

---

## Step 2：全局样式和主题（packages/ui 填充）

### `packages/ui/src/styles/tokens.css`

（内容参见 `docs/ui-spec.md` CSS 变量定义，完整复制）

### `packages/ui/src/styles/index.css`

```css
@import 'tailwindcss';
@import './tokens.css';

* {
  box-sizing: border-box;
}

body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
```

### `apps/web/src/app/layout.tsx`

```tsx
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { QueryProvider } from '@/providers/QueryProvider'
import '@yuanai/ui/styles'
import './globals.css'

export const metadata: Metadata = {
  title: '元AI',
  description: '智能 AI 聊天助手',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### `apps/web/src/providers/QueryProvider.tsx`

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1 },
        },
      })
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

---

## Step 3：packages/core 填充（stores 和 hooks）

### `packages/core/src/stores/auth.store.ts`

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@yuanai/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, token: string) => void
  setToken: (token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken) => set({ user, accessToken }),
      setToken: (accessToken) => set({ accessToken }),
      clearAuth: () => set({ user: null, accessToken: null }),
    }),
    { name: 'yuanai-auth', partialize: (s) => ({ accessToken: s.accessToken }) }
  )
)
```

### `packages/core/src/stores/chat.store.ts`

```typescript
import { create } from 'zustand'

interface ChatState {
  activeConversationId: string | null
  streamingMessageId: string | null
  streamingContent: string
  setActiveConversation: (id: string | null) => void
  startStreaming: (messageId: string) => void
  appendToken: (token: string) => void
  stopStreaming: () => void
}

export const useChatStore = create<ChatState>()((set) => ({
  activeConversationId: null,
  streamingMessageId: null,
  streamingContent: '',
  setActiveConversation: (id) => set({ activeConversationId: id }),
  startStreaming: (messageId) => set({ streamingMessageId: messageId, streamingContent: '' }),
  appendToken: (token) => set((s) => ({ streamingContent: s.streamingContent + token })),
  stopStreaming: () => set({ streamingMessageId: null, streamingContent: '' }),
}))
```

### `packages/core/src/hooks/useStream.ts`

```typescript
import { useCallback } from 'react'
import type { SSEEvent } from '@yuanai/types'
import { useAuthStore } from '../stores/auth.store'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000/api/v1'

export interface StreamChatParams {
  conversationId: string
  model: string
  content: string
  fileIds?: string[]
  onStart?: (userMsgId: string, assistantMsgId: string) => void
  onToken?: (token: string) => void
  onEnd?: (tokensUsed: number) => void
  onError?: (code: string, message: string) => void
}

export function useStream() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const sendMessage = useCallback(
    async (params: StreamChatParams) => {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          conversation_id: params.conversationId,
          model: params.model,
          message: { content: params.content, file_ids: params.fileIds ?? [] },
        }),
      })

      if (!response.ok || !response.body) {
        const err = await response.json()
        params.onError?.(err.code ?? 'STREAM_ERROR', err.message ?? '请求失败')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') return

            try {
              const event = JSON.parse(data) as SSEEvent
              if (event.type === 'message_start') {
                params.onStart?.(event.userMessageId, event.assistantMessageId)
              } else if (event.type === 'content_delta') {
                params.onToken?.(event.token)
              } else if (event.type === 'message_end') {
                params.onEnd?.(event.tokensUsed)
              } else if (event.type === 'error') {
                params.onError?.(event.code, event.message)
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    },
    [accessToken]
  )

  return { sendMessage }
}
```

---

## Step 4：核心 UI 组件（packages/ui）

### `packages/ui/src/components/Button.tsx`

```tsx
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-[var(--radius-md)] text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] text-white hover:opacity-90 active:scale-[0.98]',
        secondary:
          'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--border-default)]',
        ghost: 'hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]',
        danger: 'bg-[var(--color-error)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
```

### `packages/ui/src/components/MessageBubble.tsx`

（用户消息气泡，AI 消息无气泡直接渲染 Markdown）

```tsx
import { cn } from '../lib/cn'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  children: React.ReactNode
  className?: string
}

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
```

---

## Step 5：页面实现

### 认证页 `apps/web/src/app/(auth)/login/page.tsx`

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '@yuanai/ui'
import { apiClient } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

const schema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 位'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    const res = await apiClient.post('/auth/login', data)
    setAuth(res.data.user, res.data.access_token)
    router.push('/chat')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
      <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 shadow-sm">
        {/* 品牌 Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-from)] to-[var(--brand-to)] text-xl font-bold text-white">
            元
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">欢迎回来</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">登录你的 yuanai 账号</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
              邮箱
            </label>
            <input
              {...register('email')}
              type="email"
              placeholder="your@email.com"
              className="focus:ring-[var(--brand-from)]/30 h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-4 text-[var(--text-primary)] transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
              密码
            </label>
            <input
              {...register('password')}
              type="password"
              placeholder="••••••••"
              className="focus:ring-[var(--brand-from)]/30 h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-4 text-[var(--text-primary)] transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? '登录中...' : '登录'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
          没有账号？
          <a href="/register" className="ml-1 text-[var(--brand-solid)] hover:underline">
            立即注册
          </a>
        </p>
      </div>
    </div>
  )
}
```

### 主布局 `apps/web/src/app/(main)/layout.tsx`

```tsx
import { Sidebar } from '@/components/Sidebar'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
```

### 侧边栏 `apps/web/src/components/Sidebar.tsx`

实现要点：

- 顶部：「新建对话」按钮（品牌渐变图标 + 文字）
- 中部：会话列表（TanStack Query `useConversations`）
  - 当前会话：左侧 3px 品牌色竖线高亮
  - hover：`bg-elevated` 背景 + 显示重命名/删除操作按钮
  - 支持置顶会话排在前面
- 底部：用户头像 + 邮箱 + 「退出」按钮
- 响应式：`md:w-[260px]`，小屏折叠为左侧抽屉（Radix Dialog）

### 对话页 `apps/web/src/app/(main)/chat/[conversationId]/page.tsx`

实现要点：

```tsx
'use client'

import { use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageList } from '@/components/MessageList'
import { ChatInput } from '@/components/ChatInput'
import { ModelSelector } from '@/components/ModelSelector'
import { useChatStore } from '@yuanai/core/stores'
import { useStream } from '@yuanai/core/hooks'
import { apiClient } from '@yuanai/core/api'

export default function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = use(params)
  const queryClient = useQueryClient()
  const { streamingMessageId, streamingContent, startStreaming, appendToken, stopStreaming } =
    useChatStore()
  const { sendMessage } = useStream()

  const { data } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () =>
      apiClient.get(`/chat/conversations/${conversationId}/messages`).then((r) => r.data),
  })

  const handleSend = async (content: string, model: string, fileIds: string[]) => {
    await sendMessage({
      conversationId,
      model,
      content,
      fileIds,
      onStart: (_, assistantMsgId) => startStreaming(assistantMsgId),
      onToken: appendToken,
      onEnd: () => {
        stopStreaming()
        void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
        void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      },
      onError: (code, message) => {
        stopStreaming()
        console.error(code, message)
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
        <ModelSelector />
      </div>

      <MessageList
        messages={data?.messages ?? []}
        streamingMessageId={streamingMessageId}
        streamingContent={streamingContent}
      />

      <ChatInput onSend={handleSend} />
    </div>
  )
}
```

### 消息列表 `apps/web/src/components/MessageList.tsx`

实现要点：

- 使用 `@tanstack/react-virtual` 虚拟化（大量消息时）
- 新消息出现时自动滚动到底部
- AI 消息使用 `react-markdown` + `remark-gfm` + `rehype-highlight` 渲染
- 代码块显示语言标签 + 复制按钮
- 流式消息：当 `message.id === streamingMessageId` 时显示 `streamingContent` 而非 `message.content`

### 输入框 `apps/web/src/components/ChatInput.tsx`

实现要点：

- `textarea` 自动增高（最大 200px）
- `Enter` 发送，`Shift+Enter` 换行
- 左侧：附件上传按钮（点击触发 input[type=file]）
- 右侧：发送按钮（无内容时 disabled）
- 上传后显示文件预览缩略图（图片）或文件名（文档）
- 文件上传调用 `POST /api/v1/files/upload` 获取 file_ids

---

## Step 6：Markdown 渲染配置

### `apps/web/src/components/MarkdownRenderer.tsx`

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface Props {
  content: string
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '')
          return !inline && match ? (
            <CodeBlock language={match[1] ?? ''} code={String(children).replace(/\n$/, '')} />
          ) : (
            <code
              className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-sm"
              {...props}
            >
              {children}
            </code>
          )
        },
        // ... 其他元素样式覆盖
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
```

### `apps/web/src/components/CodeBlock.tsx`

```tsx
'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface Props {
  language: string
  code: string
}

export function CodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--code-border)]">
      <div className="flex items-center justify-between bg-[var(--code-border)] px-4 py-2">
        <span className="font-mono text-xs text-[var(--text-secondary)]">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-[var(--code-bg)] p-4">
        <code className="font-mono text-sm text-[var(--code-text)]">{code}</code>
      </pre>
    </div>
  )
}
```

---

## Step 7：主题切换

在侧边栏底部添加主题切换按钮，使用 `next-themes` 的 `useTheme`：

```tsx
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="rounded-[var(--radius-md)] p-2 transition hover:bg-[var(--bg-elevated)]"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
```

---

## 验收标准

1. 访问 `http://localhost:3000` → 未登录时重定向到 `/login`
2. 注册/登录表单正常提交，跳转到 `/chat`
3. 点击「新建对话」→ 创建并跳转
4. 在对话页输入文字，点击发送 → 出现流式 AI 回复
5. AI 回复中的 Markdown/代码块正常渲染，代码可一键复制
6. 侧边栏显示历史会话列表，点击切换
7. 右上角模型切换下拉正常工作
8. 附件按钮可上传图片并显示预览
9. 明暗主题切换生效
10. 浏览器宽度 < 768px 时侧边栏折叠为抽屉
11. `pnpm typecheck` 在 `apps/web` 无报错
