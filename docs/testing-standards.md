# 测试规范

> **核心原则：测试通过是进入下一功能的唯一许可证。**  
> 任何功能代码提交前，其对应的测试必须全部通过。集成测试未通过前，禁止进行前后端对接联调。

---

## 一、测试哲学

### 开发流程（必须遵守）

```
1. 写功能代码（或同步编写测试）
        ↓
2. 运行相关测试
        ↓
3. 全部通过？
   YES → 提交，进入下一功能
   NO  → 修复代码，回到步骤 2
        ↓
4. 关键流程完成后，编写集成测试
        ↓
5. 集成测试通过？
   YES → 可进行前后端对接联调
   NO  → 后端接口不可联调，先修复
```

### 测试分层模型

```
          /\
         /  \
        / E2E \          ← 少量，测试核心用户旅程（5-10个）
       /--------\
      / 集成测试  \       ← 中量，测试模块间协作、完整流程
     /------------\
    /   单元测试    \     ← 大量，测试单个函数/组件（快速、隔离）
   /________________\
```

| 层次     | 数量比 | 速度   | 依赖         | 目的                  |
| -------- | ------ | ------ | ------------ | --------------------- |
| 单元测试 | 70%    | 毫秒级 | 无外部依赖   | 验证函数/组件逻辑正确 |
| 集成测试 | 25%    | 秒级   | 真实 DB/API  | 验证模块协作正确      |
| E2E 测试 | 5%     | 分钟级 | 完整运行环境 | 验证用户旅程正确      |

---

## 二、前端测试（TypeScript）

### 工具栈

| 工具                        | 版本    | 用途                      |
| --------------------------- | ------- | ------------------------- |
| Vitest                      | ^2.x    | 单元测试 + 集成测试运行器 |
| @testing-library/react      | ^16.x   | React 组件测试            |
| @testing-library/user-event | ^14.x   | 用户交互模拟              |
| @testing-library/jest-dom   | ^6.x    | DOM 断言扩展              |
| msw（Mock Service Worker）  | ^2.x    | API Mock（拦截网络请求）  |
| Playwright                  | ^1.48.x | E2E 测试                  |

### 安装（在 packages/core 和 apps/web 中）

```bash
# 共享包
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom \
  msw jsdom

# Web app（额外 Playwright）
cd apps/web
pnpm add -D @playwright/test
npx playwright install chromium firefox webkit
```

### Vitest 配置

#### `packages/core/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
```

#### `apps/web/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.{ts,tsx}',
        'src/app/**/page.tsx', // Next.js 页面由集成测试覆盖
        'src/app/**/layout.tsx',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
```

#### 测试 setup 文件 `tests/setup.ts`（共用模板）

```typescript
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll } from 'vitest'
import { server } from './mocks/server'

// 每个测试后自动清理 DOM
afterEach(() => {
  cleanup()
})

// MSW 服务：在所有测试前启动，测试后关闭
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

---

### 三、MSW Mock 服务器配置

**MSW 用于拦截前端的 HTTP 请求，替代真实后端**（单元测试和组件测试中使用）。

#### `tests/mocks/handlers.ts`（前端共用 Mock）

```typescript
import { http, HttpResponse } from 'msw'
import type { AuthResponse, Conversation, Message } from '@yuanai/types'

const BASE = 'http://localhost:8000/api/v1'

// ===== 固定测试数据 =====
export const mockUser = {
  id: 'user-001',
  email: 'test@example.com',
  username: 'testuser',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

export const mockConversation: Conversation = {
  id: 'conv-001',
  title: '测试对话',
  model: 'gpt-4o',
  isPinned: false,
  lastMessageAt: '2026-01-01T12:00:00Z',
  createdAt: '2026-01-01T10:00:00Z',
}

export const mockMessages: Message[] = [
  {
    id: 'msg-001',
    role: 'user' as const,
    content: '你好',
    files: [],
    createdAt: '2026-01-01T12:00:00Z',
  },
  {
    id: 'msg-002',
    role: 'assistant' as const,
    content: '你好！我是元AI，有什么可以帮你的？',
    model: 'gpt-4o',
    files: [],
    createdAt: '2026-01-01T12:00:05Z',
  },
]

// ===== Handler 定义 =====
export const handlers = [
  // 登录
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'test@example.com' && body.password === 'Test1234!') {
      return HttpResponse.json({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        token_type: 'bearer',
        user: mockUser,
      } satisfies AuthResponse)
    }
    return HttpResponse.json(
      { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码错误' },
      { status: 401 }
    )
  }),

  // 注册
  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    if (body['email'] === 'exists@example.com') {
      return HttpResponse.json(
        { code: 'AUTH_EMAIL_EXISTS', message: '邮箱已注册' },
        { status: 409 }
      )
    }
    return HttpResponse.json({ access_token: 'mock-access-token', user: mockUser }, { status: 201 })
  }),

  // 获取当前用户
  http.get(`${BASE}/auth/me`, () => HttpResponse.json(mockUser)),

  // 会话列表
  http.get(`${BASE}/chat/conversations`, () =>
    HttpResponse.json({ conversations: [mockConversation], next_cursor: null, has_more: false })
  ),

  // 消息列表
  http.get(`${BASE}/chat/conversations/:id/messages`, () =>
    HttpResponse.json({ messages: mockMessages, next_cursor: null, has_more: false })
  ),

  // 创建会话
  http.post(`${BASE}/chat/conversations`, () =>
    HttpResponse.json(mockConversation, { status: 201 })
  ),

  // 模型列表
  http.get(`${BASE}/models`, () =>
    HttpResponse.json({
      models: [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: 'openai',
          is_default: true,
          supports_vision: true,
          supports_files: true,
          context_length: 128000,
          description: '',
        },
      ],
    })
  ),
]
```

#### `tests/mocks/server.ts`

```typescript
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

---

### 四、单元测试规范

#### 4.1 工具函数（`packages/core/src/utils/`）

**要求：100% 覆盖率，每个导出函数都有测试**

```typescript
// tests/utils/format-date.test.ts
import { describe, it, expect } from 'vitest'
import { formatRelativeDate, formatMessageTime } from '@/utils/format-date'

describe('formatRelativeDate', () => {
  it('returns "今天" for today', () => {
    const today = new Date().toISOString()
    expect(formatRelativeDate(today)).toBe('今天')
  })

  it('returns "昨天" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    expect(formatRelativeDate(yesterday)).toBe('昨天')
  })

  it('returns date string for older dates', () => {
    expect(formatRelativeDate('2026-01-01T00:00:00Z')).toMatch(/\d{1,2}月\d{1,2}日/)
  })
})

describe('formatMessageTime', () => {
  it('formats time as HH:MM', () => {
    expect(formatMessageTime('2026-01-01T14:30:00Z')).toMatch(/\d{1,2}:\d{2}/)
  })
})
```

#### 4.2 Zustand Store（`packages/core/src/stores/`）

**要求：所有 action 都有测试，初始状态有测试**

```typescript
// tests/stores/auth.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '@/stores/auth.store'

describe('useAuthStore', () => {
  beforeEach(() => {
    // 每个测试前重置 store
    useAuthStore.getState().clearAuth()
  })

  it('has empty initial state', () => {
    const { result } = renderHook(() => useAuthStore())
    expect(result.current.user).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })

  it('setAuth updates user and token', () => {
    const mockUser = {
      id: '1',
      email: 'a@b.com',
      username: 'test',
      avatar_url: null,
      createdAt: '',
    }
    const { result } = renderHook(() => useAuthStore())
    act(() => result.current.setAuth(mockUser, 'token-123'))
    expect(result.current.user).toEqual(mockUser)
    expect(result.current.accessToken).toBe('token-123')
  })

  it('clearAuth resets to initial state', () => {
    const { result } = renderHook(() => useAuthStore())
    act(() => result.current.setAuth({ id: '1' } as any, 'token'))
    act(() => result.current.clearAuth())
    expect(result.current.user).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })
})
```

#### 4.3 Hooks（`packages/core/src/hooks/`）

**要求：每个 hook 的主要行为都有测试**

```typescript
// tests/hooks/useStream.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStream } from '@/hooks/useStream'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'

describe('useStream', () => {
  it('calls onStart with message IDs when stream begins', async () => {
    // 覆盖 MSW handler，返回 SSE 流
    server.use(
      http.post('http://localhost:8000/api/v1/chat/stream', () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: message_start\ndata: {"type":"message_start","userMessageId":"u1","assistantMessageId":"a1","model":"gpt-4o"}\n\n'
              )
            )
            controller.enqueue(
              new TextEncoder().encode(
                'event: content_delta\ndata: {"type":"content_delta","token":"你好"}\n\n'
              )
            )
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            controller.close()
          },
        })
        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
    )

    const onStart = vi.fn()
    const onToken = vi.fn()
    const { result } = renderHook(() => useStream())

    await result.current.sendMessage({
      conversationId: 'conv-001',
      model: 'gpt-4o',
      content: '你好',
      onStart,
      onToken,
    })

    expect(onStart).toHaveBeenCalledWith('u1', 'a1')
    expect(onToken).toHaveBeenCalledWith('你好')
  })
})
```

---

### 五、组件测试规范（React）

#### 5.1 原则

- 测试**组件行为**，不测试实现细节（不 assert 内部 state）
- 使用 **用户视角**：通过 `screen.getByRole`, `screen.getByText` 等 accessible 查询
- 避免 `querySelector`、`getByTestId`（除非无障碍查询真的找不到）
- **必须测试**的场景：渲染正确内容、用户交互（click/type）、异步状态（loading/error/success）

#### 5.2 Button 组件测试示例

```typescript
// packages/ui/src/components/__tests__/Button.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../Button'

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>发送</Button>)
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>发送</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled and not clickable when disabled prop is set', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>发送</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows loading text in loading state', () => {
    render(<Button loading>发送</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('applies primary variant styles by default', () => {
    render(<Button>发送</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-gradient-to-r')
  })
})
```

#### 5.3 登录表单组件测试示例

```typescript
// apps/web/src/components/__tests__/LoginForm.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from '../LoginForm'

describe('LoginForm', () => {
  it('renders email and password inputs', () => {
    render(<LoginForm onSuccess={vi.fn()} />)
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })

  it('shows validation error when email is invalid', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('邮箱'), 'invalid-email')
    await user.tab()  // 失焦触发校验
    expect(await screen.findByText('请输入正确的邮箱地址')).toBeInTheDocument()
  })

  it('shows error when password is too short', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('密码'), '123')
    await user.tab()
    expect(await screen.findByText('密码至少 8 位')).toBeInTheDocument()
  })

  it('calls onSuccess with user data after successful login', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<LoginForm onSuccess={onSuccess} />)

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'Test1234!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' })
    ))
  })

  it('shows error message when credentials are wrong', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText('邮箱'), 'wrong@example.com')
    await user.type(screen.getByLabelText('密码'), 'WrongPass1!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('邮箱或密码错误，请重试')).toBeInTheDocument()
  })

  it('disables submit button while loading', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'Test1234!')

    const button = screen.getByRole('button', { name: '登录' })
    await user.click(button)
    expect(button).toBeDisabled()
  })
})
```

#### 5.4 CodeBlock 组件测试示例

```typescript
// packages/ui/src/components/__tests__/CodeBlock.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeBlock } from '../CodeBlock'

// Mock clipboard API
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

describe('CodeBlock', () => {
  it('renders language label and code', () => {
    render(<CodeBlock language="typescript" code="const x = 1" />)
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('copies code to clipboard on button click', async () => {
    const user = userEvent.setup()
    render(<CodeBlock language="python" code="print('hello')" />)
    await user.click(screen.getByRole('button', { name: /复制/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("print('hello')")
  })

  it('shows "已复制" after copy, then reverts', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<CodeBlock language="js" code="alert(1)" />)

    await user.click(screen.getByRole('button', { name: /复制/i }))
    expect(screen.getByRole('button', { name: /已复制/i })).toBeInTheDocument()

    vi.advanceTimersByTime(2000)
    expect(screen.getByRole('button', { name: /复制/i })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
```

---

### 六、前端集成测试

**目的**：测试多个组件协同工作、涉及路由跳转、数据获取的完整用户操作流程。  
**工具**：Vitest + Testing Library（带 React Router / Next.js 测试工具）  
**位置**：`tests/integration/` 目录

#### 6.1 登录流程集成测试

```typescript
// apps/web/tests/integration/auth-flow.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from '@/app/(auth)/login/page'
import { MainPage } from '@/app/(main)/chat/page'

function renderWithProviders(ui: React.ReactElement, { initialRoute = '/login' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<MainPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('登录流程', () => {
  it('成功登录后跳转到 /chat', async () => {
    const user = userEvent.setup()
    renderWithProviders(<></>, { initialRoute: '/login' })

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'Test1234!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText(/欢迎|新对话|开始对话/)).toBeInTheDocument()
    })
  })

  it('登录失败显示错误，不跳转', async () => {
    const user = userEvent.setup()
    renderWithProviders(<></>, { initialRoute: '/login' })

    await user.type(screen.getByLabelText('邮箱'), 'wrong@example.com')
    await user.type(screen.getByLabelText('密码'), 'WrongPass1!')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误，请重试')).toBeInTheDocument()
    })
    expect(screen.queryByText(/欢迎|新对话/)).not.toBeInTheDocument()
  })
})
```

#### 6.2 会话创建和发送消息集成测试

```typescript
// apps/web/tests/integration/chat-flow.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server'
import { http, HttpResponse } from 'msw'
import { ChatPage } from '@/app/(main)/chat/[conversationId]/page'

describe('对话流程', () => {
  it('创建会话并发送消息，显示 AI 回复', async () => {
    // 覆盖 stream handler
    server.use(
      http.post('*/chat/stream', () => {
        const stream = new ReadableStream({
          start(controller) {
            const encode = (s: string) => new TextEncoder().encode(s)
            controller.enqueue(
              encode(
                'event: message_start\ndata: {"type":"message_start","userMessageId":"u1","assistantMessageId":"a1","model":"gpt-4o"}\n\n'
              )
            )
            controller.enqueue(
              encode('event: content_delta\ndata: {"type":"content_delta","token":"你好！"}\n\n')
            )
            controller.enqueue(
              encode(
                'event: content_delta\ndata: {"type":"content_delta","token":"有什么可以帮你的？"}\n\n'
              )
            )
            controller.enqueue(
              encode(
                'event: message_end\ndata: {"type":"message_end","tokensUsed":20,"finishReason":"stop"}\n\n'
              )
            )
            controller.enqueue(encode('data: [DONE]\n\n'))
            controller.close()
          },
        })
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      })
    )

    const user = userEvent.setup()
    // ... render ChatPage with conversationId='conv-001'

    const input = screen.getByRole('textbox', { name: /输入消息/i })
    await user.type(input, '你好')
    await user.keyboard('{Enter}')

    // 用户消息出现
    expect(screen.getByText('你好')).toBeInTheDocument()

    // 等待 AI 回复流式完成
    await waitFor(
      () => {
        expect(screen.getByText(/你好！有什么可以帮你的？/)).toBeInTheDocument()
      },
      { timeout: 5000 }
    )
  })
})
```

---

## 七、E2E 测试（Playwright）

**位置**：`apps/web/tests/e2e/`  
**触发时机**：仅在 CI 的 PR to main/dev 时运行，本地开发不强制

### 配置 `apps/web/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
  },
})
```

### E2E 场景（v1 必须覆盖）

```typescript
// apps/web/tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('认证流程', () => {
  test('注册 → 自动登录 → 进入主界面', async ({ page }) => {
    await page.goto('/register')

    await page.fill('[name="username"]', 'e2euser')
    await page.fill('[name="email"]', 'e2e@example.com')
    await page.fill('[name="password"]', 'E2eTest1!')
    await page.fill('[name="confirmPassword"]', 'E2eTest1!')
    await page.check('[name="agreeTerms"]')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/chat/)
    await expect(page.getByText('e2euser')).toBeVisible()
  })

  test('登录成功', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'Test1234!')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/chat/)
  })

  test('登录失败显示错误信息', async ({ page }) => {
    await page.goto('/login')
    await page.fill('[name="email"]', 'wrong@example.com')
    await page.fill('[name="password"]', 'WrongPass1!')
    await page.click('button[type="submit"]')
    await expect(page.getByText('邮箱或密码错误')).toBeVisible()
  })

  test('退出登录后跳转到登录页', async ({ page }) => {
    // 先登录
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'Test1234!')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/chat/)

    // 退出
    await page.click('[data-testid="user-menu"]')
    await page.click('[data-testid="logout-btn"]')
    await expect(page).toHaveURL(/\/login/)
  })
})

// apps/web/tests/e2e/chat.spec.ts
test.describe('聊天流程', () => {
  test.beforeEach(async ({ page }) => {
    // 通过 API 直接设置 token，跳过登录 UI
    await page.goto('/login')
    await page.evaluate(() => {
      localStorage.setItem(
        'yuanai-auth',
        JSON.stringify({
          state: { accessToken: 'test-token' },
        })
      )
    })
    await page.goto('/chat')
  })

  test('新建对话并发送消息，收到 AI 回复', async ({ page }) => {
    await page.click('[data-testid="new-conversation-btn"]')
    const input = page.getByRole('textbox', { name: /输入消息/i })
    await input.fill('请介绍一下你自己')
    await page.keyboard.press('Enter')

    await expect(page.getByText('请介绍一下你自己')).toBeVisible()
    // 等待 AI 回复出现（流式输出）
    await expect(page.locator('[data-testid="ai-message"]').first()).toBeVisible({ timeout: 15000 })
  })

  test('切换模型', async ({ page }) => {
    await page.click('[data-testid="model-selector"]')
    await page.click('text=DeepSeek V3')
    await expect(page.getByTestId('model-selector')).toContainText('DeepSeek')
  })
})
```

---

## 八、后端测试规范（Python / pytest）

### 工具栈

| 工具                  | 用途                               |
| --------------------- | ---------------------------------- |
| pytest                | 测试运行器                         |
| pytest-asyncio        | 异步测试支持                       |
| httpx + ASGITransport | FastAPI 集成测试（真实 HTTP 调用） |
| pytest-postgresql     | 测试用 PostgreSQL（隔离数据库）    |
| factory-boy           | 测试数据工厂                       |
| freezegun             | 时间冻结（测试 JWT 过期等）        |

### 安装

```toml
# backend/pyproject.toml [tool.uv] dev-dependencies
[tool.uv]
dev-dependencies = [
  "pytest>=8.3.0",
  "pytest-asyncio>=0.24.0",
  "httpx>=0.28.0",
  "pytest-postgresql>=6.0.0",
  "factory-boy>=3.3.0",
  "freezegun>=1.5.0",
  "ruff>=0.8.0",
  "mypy>=1.13.0",
  "coverage>=7.6.0",
]
```

### 目录结构

```
backend/tests/
├── conftest.py              ← 全局 fixtures（DB、client、test user）
├── factories.py             ← 测试数据工厂
├── unit/                    ← 单元测试（不依赖 DB/外部服务）
│   ├── test_security.py     ← JWT、密码哈希
│   ├── test_validators.py   ← 输入校验逻辑
│   └── test_ai_service.py   ← AI service（mock openai）
└── integration/             ← 集成测试（真实 DB，httpx client）
    ├── test_auth.py         ← 注册/登录/刷新/登出完整流程
    ├── test_chat.py         ← 会话 CRUD + 消息发送
    ├── test_stream.py       ← SSE 流式接口
    └── test_files.py        ← 文件上传
```

### conftest.py（关键 fixtures）

```python
# backend/tests/conftest.py
import asyncio
import pytest
import uuid
from collections.abc import AsyncGenerator

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.user import User

# ===== 测试数据库（每个测试函数独立事务，测试后回滚）=====
TEST_DATABASE_URL = "postgresql+asyncpg://yuanai:password@localhost:5432/yuanai_test"

test_engine = create_async_engine(TEST_DATABASE_URL)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
async def setup_database() -> AsyncGenerator[None, None]:
    """测试开始前建表，结束后删表"""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    """每个测试用独立事务，测试后回滚，隔离数据"""
    async with test_engine.begin() as conn:
        async with TestSessionLocal(bind=conn) as session:
            yield session
            await session.rollback()


@pytest.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """注入测试 DB 的 HTTP client"""
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def test_user(db: AsyncSession) -> User:
    """创建并持久化测试用户"""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        username="testuser",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    """返回携带有效 token 的请求头"""
    token = create_access_token(str(test_user.id))
    return {"Authorization": f"Bearer {token}"}
```

### factories.py

```python
# backend/tests/factories.py
import factory
import uuid
from app.core.security import hash_password
from app.models.user import User
from app.models.conversation import Conversation


class UserFactory(factory.Factory):
    class Meta:
        model = User

    id = factory.LazyFunction(uuid.uuid4)
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    username = factory.Sequence(lambda n: f"user{n}")
    hashed_password = factory.LazyFunction(lambda: hash_password("Test1234!"))
    avatar_url = None


class ConversationFactory(factory.Factory):
    class Meta:
        model = Conversation

    id = factory.LazyFunction(uuid.uuid4)
    title = "测试对话"
    model = "gpt-4o"
    is_pinned = False
```

### 单元测试示例

```python
# backend/tests/unit/test_security.py
import pytest
from freezegun import freeze_time
from app.core.security import (
    hash_password, verify_password,
    create_access_token, decode_token,
)


def test_hash_and_verify_password() -> None:
    hashed = hash_password("Test1234!")
    assert verify_password("Test1234!", hashed)
    assert not verify_password("WrongPass", hashed)


def test_create_and_decode_access_token() -> None:
    token = create_access_token("user-123")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"


@freeze_time("2026-01-01 00:00:00")
def test_expired_token_raises_error() -> None:
    token = create_access_token("user-123")

    # 16 分钟后（token 15 分钟有效）
    with freeze_time("2026-01-01 00:16:00"):
        with pytest.raises(ValueError, match="Invalid token"):
            decode_token(token)
```

### 集成测试示例（认证流程）

```python
# backend/tests/integration/test_auth.py
import pytest
from httpx import AsyncClient
from app.models.user import User


@pytest.mark.asyncio
class TestRegister:
    async def test_register_success(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/register", json={
            "email": "new@example.com",
            "password": "NewPass1!",
            "username": "newuser",
        })
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user"]["email"] == "new@example.com"

    async def test_register_duplicate_email(
        self, client: AsyncClient, test_user: User
    ) -> None:
        response = await client.post("/api/v1/auth/register", json={
            "email": test_user.email,  # 已存在
            "password": "Test1234!",
            "username": "otherusername",
        })
        assert response.status_code == 409
        assert response.json()["code"] == "AUTH_EMAIL_EXISTS"

    async def test_register_weak_password(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/register", json={
            "email": "weak@example.com",
            "password": "12345678",   # 无大写、无特殊字符
            "username": "weakuser",
        })
        assert response.status_code == 422  # Pydantic validation


@pytest.mark.asyncio
class TestLogin:
    async def test_login_success(self, client: AsyncClient, test_user: User) -> None:
        response = await client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "Test1234!",
        })
        assert response.status_code == 200
        assert "access_token" in response.json()

    async def test_login_wrong_password(
        self, client: AsyncClient, test_user: User
    ) -> None:
        response = await client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "WrongPass1!",
        })
        assert response.status_code == 401
        assert response.json()["code"] == "AUTH_INVALID_CREDENTIALS"

    async def test_login_nonexistent_user(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/login", json={
            "email": "notexist@example.com",
            "password": "Test1234!",
        })
        assert response.status_code == 401


@pytest.mark.asyncio
class TestProtectedRoute:
    async def test_get_me_requires_auth(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 403  # 无 token

    async def test_get_me_with_valid_token(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ) -> None:
        response = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["email"] == test_user.email
```

### 集成测试示例（聊天流程）

```python
# backend/tests/integration/test_chat.py
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch
from app.models.user import User


@pytest.mark.asyncio
class TestConversation:
    async def test_create_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "测试对话"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "测试对话"
        assert data["model"] == "gpt-4o"

    async def test_list_conversations_empty_for_new_user(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["conversations"] == []

    async def test_delete_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        # 先创建
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        # 删除
        delete_res = await client.delete(
            f"/api/v1/chat/conversations/{conv_id}", headers=auth_headers
        )
        assert delete_res.status_code == 204

        # 确认已删除
        list_res = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        convs = list_res.json()["conversations"]
        assert not any(c["id"] == conv_id for c in convs)

    async def test_cannot_access_other_users_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str], db: object
    ) -> None:
        # 用其他用户的 token 尝试访问
        from app.core.security import create_access_token
        import uuid
        other_token = create_access_token(str(uuid.uuid4()))
        other_headers = {"Authorization": f"Bearer {other_token}"}

        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        response = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=other_headers,
        )
        assert response.status_code in (403, 404)


@pytest.mark.asyncio
class TestStream:
    async def test_stream_returns_sse(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        # 创建会话
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        # Mock AI service，避免调用真实 API
        async def mock_stream(*args: object, **kwargs: object):
            yield "你好"
            yield "！"

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "你好", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers["content-type"]

                events = []
                async for line in response.aiter_lines():
                    if line.startswith("data:") and "[DONE]" not in line:
                        events.append(line)

                assert any("message_start" in e for e in events)
                assert any("content_delta" in e for e in events)
                assert any("你好" in e for e in events)
```

---

## 九、覆盖率要求汇总

| 模块                          | 行覆盖率 | 函数覆盖率 | 分支覆盖率 |
| ----------------------------- | -------- | ---------- | ---------- |
| `packages/core/src/utils/`    | **90%**  | 90%        | 80%        |
| `packages/core/src/stores/`   | **85%**  | 85%        | 75%        |
| `packages/core/src/hooks/`    | **80%**  | 80%        | 70%        |
| `packages/ui/src/components/` | **70%**  | 75%        | 65%        |
| `apps/web/src/components/`    | **70%**  | 70%        | 60%        |
| `backend/app/services/`       | **85%**  | 85%        | 75%        |
| `backend/app/api/`            | **80%**  | 80%        | 70%        |
| `backend/app/core/`           | **75%**  | 75%        | 65%        |

**覆盖率低于阈值时，CI 强制失败，PR 不可合并。**

---

## 十、必须编写集成测试的场景

下列场景**完成功能开发后必须有对应集成测试才能进入下一模块**：

### 前端集成测试（Vitest）

- [ ] 登录成功跳转 + 登录失败显示错误
- [ ] 注册表单完整校验（含密码强度）
- [ ] 忘记密码两步流程
- [ ] 新建会话 → 发送消息 → 显示流式回复
- [ ] 会话列表加载 + 切换会话
- [ ] 删除会话 → 列表更新
- [ ] 模型切换 → 下次发送使用新模型
- [ ] 文件上传 → 预览 → 随消息发送
- [ ] 主题切换持久化（刷新后保留）

### 后端集成测试（pytest）

- [ ] 注册 → 登录 → 刷新 token → 登出 完整认证流
- [ ] 创建会话 → 发送消息 → 获取历史消息
- [ ] SSE 流式接口返回正确事件序列
- [ ] 文件上传 → 存储 → URL 可访问
- [ ] 权限隔离：用户 A 不能访问用户 B 的会话
- [ ] 频率限制：超限后返回 429

### E2E 测试（Playwright，v1 核心路径）

- [ ] 注册 → 登录 → 发起对话 → 收到回复
- [ ] 登录 → 切换模型 → 发起对话
- [ ] 退出登录 → 再次访问跳转到登录页
