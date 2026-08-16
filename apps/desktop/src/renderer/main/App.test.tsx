import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type Key, type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '@yuanai/types'

const chat = vi.hoisted(() => ({
  conversations: [] as Array<{
    id: string
    title: string
    model: string
    isPinned: boolean
    lastMessageAt: string | null
    createdAt: string
  }>,
  createConversation: vi.fn(),
  createMediaTask: vi.fn(),
  mediaTasks: [],
  createShareLink: vi.fn(),
  deleteConversation: vi.fn(),
  deleteConversations: vi.fn(),
  cancelMediaTask: vi.fn(),
  messages: [] as Array<{
    id: string
    role: string
    content: string
    regeneratedFromMessageId?: string
    files: Array<{
      id: string
      filename: string
      mimeType: string
      sizeBytes: number
      url: string
    }>
    createdAt: string
  }>,
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      description: '',
      supportsVision: true,
      supportsFiles: true,
      contextLength: 128000,
      isDefault: true,
    },
    {
      id: 'gpt-4.1-mini',
      name: 'GPT-4.1 mini',
      provider: 'openai',
      description: '快速响应模型',
      supportsVision: true,
      supportsFiles: true,
      contextLength: 128000,
      isDefault: false,
    },
  ],
  send: vi.fn(),
  sendTemporary: vi.fn(),
  logout: vi.fn(),
  shareLink: null as {
    shareToken: string
    titleSnapshot: string
    createdAt: string
    expiresAt: string | null
    hasPassword: boolean
  } | null,
  revokeShareLink: vi.fn(),
  stop: vi.fn(),
  streamState: {
    streams: {} as Record<
      string,
      {
        conversationId: string
        content: string
        thinking: string
        thinkingDurationMs: number
        toolCalls: ToolCall[]
        optimisticUserMessage: string | null
        optimisticFiles: never[]
      }
    >,
  },
  uploadFileSmart: vi.fn(),
  updateConversation: vi.fn(),
  updatePreferences: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  clearAuth: vi.fn(),
  user: null as {
    id: string
    email: string
    username: string
    avatarUrl: string | null
    createdAt: string
  } | null,
}))

const prefs = vi.hoisted(() => ({
  dateFmt: 'ymd' as const,
  setDateFmt: vi.fn(),
  setTheme: vi.fn(),
  setTimeFmt: vi.fn(),
  theme: 'light' as const,
  timeFmt: '24h' as const,
}))

const desktop = vi.hoisted(() => ({
  writeClipboardText: vi.fn<(value: string) => Promise<void>>(),
  openFiles: vi.fn(),
  listScreenSources: vi.fn(),
  openArtifact: vi.fn(),
  respondMediaPermission:
    vi.fn<(response: { requestId: string; granted: boolean }) => Promise<boolean>>(),
  mediaPermissionListener: null as
    ((request: { requestId: string; mediaType: 'audio' | 'video' }) => void) | null,
}))

const virtuoso = vi.hoisted(() => ({
  isScrolling: null as ((scrolling: boolean) => void) | null,
  scrollToIndex: vi.fn(),
}))

const voiceInput = vi.hoisted(() => ({
  onError: null as ((message: string) => void) | null,
  onTranscript: null as ((text: string) => void) | null,
  value: {
    cancel: vi.fn(),
    error: null as string | null,
    isAvailable: true,
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    status: 'idle' as 'idle' | 'listening' | 'recording' | 'transcribing' | 'error',
    stop: vi.fn(),
  },
}))

vi.mock('react-virtuoso', async () => {
  return {
    Virtuoso: (props: {
      'aria-busy'?: boolean
      atBottomStateChange?(atBottom: boolean): void
      className?: string
      computeItemKey?(index: number, item: unknown): Key
      data: unknown[]
      isScrolling?(scrolling: boolean): void
      itemContent(index: number, item: unknown): ReactNode
      ref?:
        | ((value: { scrollToIndex: typeof virtuoso.scrollToIndex } | null) => void)
        | { current: { scrollToIndex: typeof virtuoso.scrollToIndex } | null }
        | null
    }) => {
      virtuoso.isScrolling = props.isScrolling ?? null
      if (typeof props.ref === 'function') {
        props.ref({ scrollToIndex: virtuoso.scrollToIndex })
      } else if (props.ref) {
        props.ref.current = { scrollToIndex: virtuoso.scrollToIndex }
      }

      // JSDOM does not implement layout measurement. Keep a bounded viewport so
      // App tests exercise the same virtual-rendering contract as Electron.
      const visibleRows = props.data.slice(-12)
      return createElement(
        'div',
        {
          'aria-busy': props['aria-busy'],
          className: props.className,
          'data-testid': 'virtual-message-scroller',
          onScroll: () => props.atBottomStateChange?.(false),
        },
        visibleRows.map((row, index) =>
          createElement(
            'div',
            { key: props.computeItemKey?.(index, row) ?? index },
            props.itemContent(index, row)
          )
        )
      )
    },
  }
})

vi.mock('@yuanai/core/hooks', () => ({
  useConversations: () => ({ data: chat.conversations, isLoading: false }),
  useCreateConversation: () => ({ isPending: false, mutateAsync: chat.createConversation }),
  useCreateMediaTask: () => ({
    isPending: false,
    mutate: chat.createMediaTask,
    mutateAsync: chat.createMediaTask,
  }),
  useCancelMediaTask: () => ({ isPending: false, mutate: chat.cancelMediaTask }),
  useDeleteConversation: () => ({ isPending: false, mutateAsync: chat.deleteConversation }),
  useDeleteConversations: () => ({ isPending: false, mutateAsync: chat.deleteConversations }),
  useLogout: () => ({ isPending: false, mutateAsync: chat.logout }),
  useMessages: () => ({ data: chat.messages, isLoading: false }),
  useMediaTasks: () => ({ data: chat.mediaTasks, isLoading: false }),
  useModels: () => ({ data: chat.models }),
  useShareLink: () => ({ data: chat.shareLink, isLoading: false }),
  useCreateShareLink: () => ({ isPending: false, mutateAsync: chat.createShareLink }),
  useRevokeShareLink: () => ({ isPending: false, mutateAsync: chat.revokeShareLink }),
  useStream: () => ({ send: chat.send, sendTemporary: chat.sendTemporary, stop: chat.stop }),
  TEMPORARY_CONV_ID: '__temporary__',
  useUpdateConversation: () => ({ isPending: false, mutateAsync: chat.updateConversation }),
  useUpdateMyPreferences: () => ({ isPending: false, mutateAsync: chat.updatePreferences }),
  uploadFileSmart: chat.uploadFileSmart,
}))

vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
  useChatStore: (selector: (state: typeof chat.streamState) => unknown) =>
    selector(chat.streamState),
  selectConversationStream: (
    state: typeof chat.streamState,
    conversationId: string | null | undefined
  ) =>
    (conversationId ? state.streams[conversationId] : undefined) ?? {
      conversationId: '',
      content: '',
      thinking: '',
      thinkingDurationMs: 0,
      toolCalls: [],
      optimisticUserMessage: null,
      optimisticFiles: [],
    },
  usePrefsStore: (selector: (state: typeof prefs) => unknown) => selector(prefs),
}))

vi.mock('./useVoiceInput', () => ({
  useVoiceInput: ({
    onError,
    onTranscript,
  }: {
    onError?: (message: string) => void
    onTranscript: (text: string) => void
  }) => {
    voiceInput.onError = onError ?? null
    voiceInput.onTranscript = onTranscript
    return voiceInput.value
  },
}))

import { changeDesktopLanguage } from '../shared/i18n'
import { App } from './App'

function makeStreamingState(overrides: Partial<(typeof chat.streamState.streams)[string]> = {}) {
  return {
    conversationId: 'conversation-1',
    content: '',
    thinking: '',
    thinkingDurationMs: 0,
    toolCalls: [],
    optimisticUserMessage: null,
    optimisticFiles: [],
    ...overrides,
  }
}

beforeEach(() => {
  virtuoso.isScrolling = null
  virtuoso.scrollToIndex.mockReset()
  voiceInput.onError = null
  voiceInput.onTranscript = null
  desktop.mediaPermissionListener = null
  desktop.respondMediaPermission.mockResolvedValue(true)
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      clipboard: {
        writeText: desktop.writeClipboardText,
      },
      dialog: {
        openFiles: desktop.openFiles,
        listScreenSources: desktop.listScreenSources,
      },
      window: {
        openLogin: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openRegister: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openForgot: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openAbout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openArtifact: desktop.openArtifact,
      },
      runtime: {
        getConfig: vi
          .fn<() => Promise<{ apiBaseUrl: string; webBaseUrl: string; assetOrigins: [] }>>()
          .mockResolvedValue({
            apiBaseUrl: 'http://localhost:8000/api/v1',
            webBaseUrl: 'http://localhost:3000',
            assetOrigins: [],
          }),
      },
      appearance: {
        apply: vi.fn<() => Promise<{ choice: 'light'; resolved: 'light' }>>().mockResolvedValue({
          choice: 'light',
          resolved: 'light',
        }),
      },
      permissions: {
        respond: desktop.respondMediaPermission,
      },
      events: {
        onMediaPermissionRequested: (listener: typeof desktop.mediaPermissionListener) => {
          desktop.mediaPermissionListener = listener
          return () => {
            if (desktop.mediaPermissionListener === listener) {
              desktop.mediaPermissionListener = null
            }
          }
        },
      },
    },
  })
  auth.user = {
    id: 'desktop-user',
    email: 'desktop@example.com',
    username: '桌面用户',
    avatarUrl: null,
    createdAt: '2026-08-10T08:00:00.000Z',
  }
  chat.conversations = [
    {
      id: 'conversation-1',
      title: '测试会话',
      model: 'gpt-4o',
      isPinned: false,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ]
  chat.messages = [
    {
      id: 'message-1',
      role: 'assistant',
      content: '你好，我可以帮你处理问题。',
      files: [],
      createdAt: '2026-08-10T08:00:00.000Z',
    },
  ]
  chat.models = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      description: '',
      supportsVision: true,
      supportsFiles: true,
      contextLength: 128000,
      isDefault: true,
    },
    {
      id: 'gpt-4.1-mini',
      name: 'GPT-4.1 mini',
      provider: 'openai',
      description: '快速响应模型',
      supportsVision: true,
      supportsFiles: true,
      contextLength: 128000,
      isDefault: false,
    },
  ]
  chat.createConversation.mockResolvedValue({
    id: 'conversation-2',
    title: '新对话',
    model: 'gpt-4o',
    isPinned: false,
    lastMessageAt: null,
    createdAt: '2026-08-10T08:00:00.000Z',
  })
  chat.updateConversation.mockResolvedValue({
    id: 'conversation-1',
    title: '测试会话',
    model: 'gpt-4.1-mini',
    isPinned: false,
    lastMessageAt: new Date().toISOString(),
    createdAt: '2026-08-10T08:00:00.000Z',
  })
  chat.deleteConversations.mockResolvedValue(undefined)
  chat.shareLink = null
  chat.createShareLink.mockResolvedValue({
    shareToken: 'desktop-share-token',
    titleSnapshot: '测试会话',
    createdAt: '2026-08-10T08:00:00.000Z',
    expiresAt: null,
    hasPassword: false,
  })
  chat.revokeShareLink.mockResolvedValue(undefined)
  chat.streamState.streams = {}
  chat.send.mockResolvedValue(undefined)
  chat.sendTemporary.mockResolvedValue(undefined)
  chat.updatePreferences.mockResolvedValue(undefined)
  chat.uploadFileSmart.mockResolvedValue({ id: 'file-1' })
  desktop.openFiles.mockResolvedValue([])
  desktop.listScreenSources.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-theme')
  void changeDesktopLanguage('zh-CN')
})

describe('desktop chat', () => {
  it('uses all chat-model fallbacks and excludes media-only models until the API is available', async () => {
    const user = userEvent.setup()
    chat.models = []
    render(<App />)

    expect(
      screen.getByRole('button', { name: '选择模型：DeepSeek V4 Flash-0731' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择模型：DeepSeek V4 Flash-0731' }))

    expect(screen.getByRole('option', { name: '选择 DeepSeek V4 Flash-0731' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '选择 DeepSeek V4 Pro-0813' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '选择 Agnes 2.5 Flash' })).toBeInTheDocument()
    expect(screen.queryByText('Agnes Image 2.1 Flash')).not.toBeInTheDocument()
    expect(screen.queryByText('Agnes Video V2.0')).not.toBeInTheDocument()
  })

  it('shows the welcome state instead of a false streaming response when no conversation is active', () => {
    chat.conversations = []
    chat.messages = []
    render(<App />)

    expect(screen.getByRole('heading', { name: '你好，我是元AI' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  })

  it('does not expose cached conversations while signed out', () => {
    auth.user = null
    render(<App />)

    expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '最近会话' })).toHaveTextContent('暂无会话')
    expect(screen.queryByRole('button', { name: '测试会话' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '你好，我是元AI' })).toBeInTheDocument()
  })

  it('opens code artifacts and regenerates from the preceding user message', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '请展示一个标题',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: '```html\n<h1>元AI</h1>\n```',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    expect(document.querySelector('.desktop-chat__code-highlight')).toHaveTextContent(
      '<h1>元AI</h1>'
    )

    await user.click(screen.getByRole('button', { name: '展示面板' }))
    expect(desktop.openArtifact).toHaveBeenCalledWith({
      code: '<h1>元AI</h1>',
      lang: 'html',
      mode: 'view',
      theme: 'light',
      title: 'html',
    })

    await user.click(screen.getByRole('button', { name: '重新生成回答' }))
    await waitFor(() => {
      expect(chat.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '请展示一个标题',
          convId: 'conversation-1',
          model: 'gpt-4o',
          regenerateFromMessageId: 'message-user',
          skipOptimistic: true,
        })
      )
    })
  })

  it('uses plain code while the virtual chat list is moving, then restores highlighting', () => {
    vi.useFakeTimers()
    chat.messages = [
      {
        id: 'message-code',
        role: 'assistant',
        content: '```javascript\nconst answer = 42\n```',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    const { container } = render(<App />)

    expect(
      container.querySelector('.desktop-chat__code-highlight[data-code-rendering="syntax"]')
    ).toBeInTheDocument()

    act(() => virtuoso.isScrolling?.(true))

    expect(
      container.querySelector('.desktop-chat__code-highlight[data-code-rendering="plain"]')
    ).toBeInTheDocument()

    act(() => {
      virtuoso.isScrolling?.(false)
      vi.advanceTimersByTime(180)
    })

    expect(
      container.querySelector('.desktop-chat__code-highlight[data-code-rendering="syntax"]')
    ).toBeInTheDocument()
  })

  it('opens JSON and CSV code blocks directly in data preview mode', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-json',
        role: 'assistant',
        content: '```json\n{"name":"元AI"}\n```',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('button', { name: '数据预览' }))

    expect(desktop.openArtifact).toHaveBeenCalledWith({
      code: '{"name":"元AI"}',
      lang: 'json',
      mode: 'run',
      theme: 'light',
      title: 'json 预览',
    })

    unmount()
    desktop.openArtifact.mockClear()
    chat.messages = [
      {
        id: 'message-csv',
        role: 'assistant',
        content: '```csv\n名称,价格\n苹果,5\n```',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '数据预览' }))

    expect(desktop.openArtifact).toHaveBeenCalledWith({
      code: '名称,价格\n苹果,5',
      lang: 'csv',
      mode: 'run',
      theme: 'light',
      title: 'csv 预览',
    })
  })

  it('uses one assistant copy entry and reveals the Web copy formats on hover', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '请用 Markdown 回答',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: '**这是 Markdown 回复**',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    expect(screen.getAllByRole('button', { name: '复制内容' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '复制纯文本' })).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: '复制内容' }))

    expect(screen.getByRole('menu', { name: '复制格式' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制 Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制纯文本' })).toBeInTheDocument()
  })

  it('writes assistant Markdown through the native clipboard bridge before showing success', async () => {
    const user = userEvent.setup()
    desktop.writeClipboardText.mockResolvedValue(undefined)
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '请复制下面回复',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: '**可复制的 Markdown**',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '复制内容' }))

    await waitFor(() => {
      expect(desktop.writeClipboardText).toHaveBeenCalledWith('**可复制的 Markdown**')
    })
  })

  it('groups regenerated answers into one user question and switches their versions', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user-v1',
        role: 'user',
        content: '给我两个不同版本的回答',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant-v1',
        role: 'assistant',
        content: '第一版回答',
        files: [],
        createdAt: '2026-08-10T08:00:01.000Z',
      },
      {
        id: 'message-user-v2',
        role: 'user',
        content: '给我两个不同版本的回答',
        regeneratedFromMessageId: 'message-user-v1',
        files: [],
        createdAt: '2026-08-10T08:00:02.000Z',
      },
      {
        id: 'message-assistant-v2',
        role: 'assistant',
        content: '第二版回答',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    expect(screen.getAllByText('给我两个不同版本的回答')).toHaveLength(1)
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('第二版回答')).toBeInTheDocument()
    expect(screen.queryByText('第一版回答')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '上一个版本' }))

    expect(screen.getByText('第一版回答')).toBeInTheDocument()
    expect(screen.queryByText('第二版回答')).not.toBeInTheDocument()
  })

  it('submits assistant feedback and cancels it when the same feedback is chosen again', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '这份回答怎么样？',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: '这是一份可反馈的回答。',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '回答有帮助' }))
    expect(screen.getByRole('dialog', { name: '哪方面让你满意？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '解释清晰' }))
    await user.type(screen.getByRole('textbox', { name: '反馈说明' }), '层次很清楚')
    await user.click(screen.getByRole('button', { name: '提交反馈' }))

    const feedbackButton = screen.getByRole('button', { name: '回答有帮助' })
    expect(screen.queryByRole('dialog', { name: '哪方面让你满意？' })).not.toBeInTheDocument()
    expect(feedbackButton).toHaveClass('is-active')

    await user.click(feedbackButton)
    expect(feedbackButton).not.toHaveClass('is-active')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('overwrites the edited user message instead of appending a new one', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '原始问题',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '编辑消息' }))
    const editor = screen.getByRole('textbox', { name: '编辑消息' })
    await user.clear(editor)
    await user.type(editor, '编辑后的问题')
    await user.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(chat.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '编辑后的问题',
          convId: 'conversation-1',
          model: 'gpt-4o',
          replaceMessageId: 'message-user',
          skipOptimistic: true,
        })
      )
    })
  })

  it('replaces the user bubble with the Web-style editor while editing', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '需要替换的原始消息',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '编辑消息' }))

    expect(
      screen.queryByText('需要替换的原始消息', { selector: '.desktop-chat__message-bubble' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '编辑消息' })).toHaveValue('需要替换的原始消息')
    expect(screen.getByText('Shift+Enter 换行 · Enter 提交')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument()
  })

  it('formats both user and assistant timestamps from the shared preference store', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T08:30:00.000Z'))
    chat.messages = [
      {
        id: 'message-user',
        role: 'user',
        content: '带时间的用户消息',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: '带时间的 AI 消息',
        files: [],
        createdAt: '2026-08-10T08:01:00.000Z',
      },
    ]
    render(<App />)

    expect(screen.getByText('16:00')).toBeInTheDocument()
    expect(screen.getByText('16:01')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows active thinking and tool calls for the streaming assistant message', () => {
    chat.streamState.streams['conversation-1'] = makeStreamingState({
      thinking: '先检索相关资料',
      thinkingDurationMs: 800,
      toolCalls: [
        {
          id: 'tool-1',
          name: 'search_web',
          arguments: '{"query":"元AI"}',
          status: 'running',
        },
      ],
    })
    render(<App />)

    expect(screen.getByRole('button', { name: '正在思考…' })).toBeInTheDocument()
    expect(screen.getByText('search_web')).toBeInTheDocument()
    expect(screen.getByText('{"query":"元AI"}')).toBeInTheDocument()
  })

  it('fills the Web-aligned quick prompt from the empty chat state', async () => {
    const user = userEvent.setup()
    chat.conversations = []
    chat.messages = []
    render(<App />)

    await user.click(screen.getByRole('button', { name: '快捷提示：文件分析' }))

    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue('帮我总结这份文件的要点')
  })

  it('enables web search when a web-search quick prompt is selected', async () => {
    const user = userEvent.setup()
    chat.conversations = []
    chat.messages = []
    render(<App />)

    const composerWebSearch = screen
      .getAllByRole('button', { name: '联网搜索' })
      .find((button) => button.hasAttribute('aria-pressed'))
    if (!composerWebSearch) throw new Error('未找到输入框工具栏的联网搜索按钮')

    await user.click(composerWebSearch)
    expect(composerWebSearch).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: '快捷提示：联网搜索' }))

    expect(composerWebSearch).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue(
      '联网搜索最新 AI 行业动态'
    )
  })

  it('does not fill quick prompts while signed out', async () => {
    const user = userEvent.setup()
    auth.user = null
    chat.conversations = []
    chat.messages = []
    render(<App />)

    const capability = screen.getByRole('button', { name: '快捷提示：文件分析' })
    const suggestion = screen.getByRole('button', { name: '创意写作' })

    expect(capability).toBeDisabled()
    expect(suggestion).toBeDisabled()

    await user.click(capability)
    await user.click(suggestion)

    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue('')
  })

  it('creates a conversation using the selected model', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '新建会话' }))

    await waitFor(() => {
      expect(chat.createConversation).toHaveBeenCalledWith({ model: 'gpt-4o', title: '新对话' })
    })
  })

  it('sends the entered message to the active conversation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '测试会话' })
    await user.type(screen.getByRole('textbox', { name: '输入消息' }), '请帮我总结这段内容')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => {
      expect(chat.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '请帮我总结这段内容',
          convId: 'conversation-1',
          model: 'gpt-4o',
        })
      )
    })
  })

  it('shows a scroll-to-bottom action without forcing readers back during streaming', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    const messages = screen.getByTestId('virtual-message-scroller')

    await waitFor(() => {
      expect(virtuoso.scrollToIndex).toHaveBeenCalledWith({
        behavior: 'auto',
        index: 'LAST',
        align: 'end',
      })
    })
    virtuoso.scrollToIndex.mockClear()

    fireEvent.scroll(messages)

    const action = screen.getByRole('button', { name: '回到底部' })
    expect(action).toBeInTheDocument()

    chat.streamState.streams['conversation-1'] = makeStreamingState({ content: '仍在生成的回复' })
    view.rerender(<App />)

    expect(virtuoso.scrollToIndex).not.toHaveBeenCalled()

    await user.click(action)

    expect(virtuoso.scrollToIndex).toHaveBeenCalledWith({
      behavior: 'smooth',
      index: 'LAST',
      align: 'end',
    })
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument()
  })

  it('virtualizes long chat history instead of retaining every message node', () => {
    chat.messages = Array.from({ length: 80 }, (_value, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `历史消息 ${index + 1}`,
      files: [],
      createdAt: `2026-08-10T08:${String(index).padStart(2, '0')}:00.000Z`,
    }))

    render(<App />)

    expect(screen.getByText('历史消息 80')).toBeInTheDocument()
    expect(screen.queryByText('历史消息 1')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.desktop-chat__message').length).toBeLessThan(30)
  })

  it('renders user messages as a right-aligned Web-style bubble', () => {
    chat.messages = [
      {
        id: 'message-user-1',
        role: 'user',
        content: '请将这条消息显示在右侧气泡中。',
        files: [],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    render(<App />)

    const message = screen.getByText('请将这条消息显示在右侧气泡中。')
    expect(message.closest('article')).toHaveClass('desktop-chat__message--user')
    expect(message.parentElement).toHaveClass('desktop-chat__message-bubble')
    expect(message.closest('article')).not.toHaveTextContent('元')
  })

  it('renders image attachments in message history as thumbnails', () => {
    chat.messages = [
      {
        id: 'message-user-image-1',
        role: 'user',
        content: '请分析这张图片。',
        files: [
          {
            id: 'image-file-1',
            filename: 'yuanai-login-before.png',
            mimeType: 'image/png',
            sizeBytes: 61_574,
            url: 'http://127.0.0.1:9000/yuanai-files/yuanai-login-before.png',
          },
        ],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    render(<App />)

    const image = screen.getByRole('img', { name: 'yuanai-login-before.png' })
    expect(image).toHaveAttribute(
      'src',
      'http://127.0.0.1:9000/yuanai-files/yuanai-login-before.png'
    )
    expect(image.closest('li')).toHaveClass('desktop-chat__file--image')
  })

  it('opens image attachments in the dedicated Artifact preview window', async () => {
    const user = userEvent.setup()
    chat.messages = [
      {
        id: 'message-user-image-1',
        role: 'user',
        content: '请分析这张图片。',
        files: [
          {
            id: 'image-file-1',
            filename: 'yuanai-login-before.png',
            mimeType: 'image/png',
            sizeBytes: 61_574,
            url: 'http://127.0.0.1:9000/yuanai-files/yuanai-login-before.png',
          },
        ],
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    render(<App />)

    await user.click(screen.getByRole('button', { name: '预览图片 yuanai-login-before.png' }))
    expect(desktop.openArtifact).toHaveBeenCalledWith({
      kind: 'file-preview',
      mimeType: 'image/png',
      sourceUrl: 'http://127.0.0.1:9000/yuanai-files/yuanai-login-before.png',
      theme: 'light',
      title: 'yuanai-login-before.png',
    })
  })

  it('uses the selected conversation model for the next message', async () => {
    const user = userEvent.setup()
    chat.conversations.push({
      id: 'conversation-2',
      title: '快速模型会话',
      model: 'gpt-4.1-mini',
      isPinned: false,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    render(<App />)

    await user.click(screen.getByRole('button', { name: '快速模型会话' }))

    expect(screen.getByRole('button', { name: '选择模型：GPT-4.1 mini' })).toBeInTheDocument()
  })

  it('confirms deletion in an accessible app dialog instead of a browser popup', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '更多会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除' }))

    expect(screen.getByRole('alertdialog', { name: '删除会话？' })).toBeInTheDocument()
    expect(screen.getByText('“测试会话”及其中的消息将被永久删除。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '更多会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(chat.deleteConversation).toHaveBeenCalledWith('conversation-1'))
  })

  it('opens conversation actions on right click and batch deletes the selected conversations', async () => {
    const user = userEvent.setup()
    chat.conversations.push({
      id: 'conversation-2',
      title: '第二个会话',
      model: 'gpt-4o',
      isPinned: false,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    render(<App />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '测试会话' }), {
      clientX: 120,
      clientY: 180,
    })

    expect(screen.getByRole('menu', { name: '会话操作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '置顶' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '多选' }))

    expect(screen.getByRole('toolbar', { name: '批量选择会话' })).toHaveTextContent('已选择 1 项')
    await user.click(screen.getByRole('button', { name: '第二个会话' }))
    expect(screen.getByRole('toolbar', { name: '批量选择会话' })).toHaveTextContent('已选择 2 项')

    await user.click(screen.getByRole('button', { name: '删除已选' }))
    expect(screen.getByRole('alertdialog', { name: '删除 2 个会话？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(chat.deleteConversations).toHaveBeenCalledWith(['conversation-1', 'conversation-2'])
    })
  })

  it('opens a Web-compatible share dialog for the active conversation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '分享对话' }))

    expect(screen.getByRole('dialog', { name: '分享此对话' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成分享链接' })).toBeInTheDocument()
  })

  it('keeps a share password hidden until the user requests to reveal it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '分享对话' }))
    await user.click(screen.getByRole('switch', { name: '启用访问密码' }))

    const passwordInput = screen.getByLabelText('访问密码')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.type(passwordInput, 'share-password')
    await user.click(screen.getByRole('button', { name: '显示访问密码' }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('switch', { name: '关闭访问密码' }))
    await user.click(screen.getByRole('switch', { name: '启用访问密码' }))

    expect(screen.getByLabelText('访问密码')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('访问密码')).toHaveValue('')
  })

  it('uses the temporary stream without creating a persisted conversation', async () => {
    const user = userEvent.setup()
    render(<App />)

    const temporaryToggle = screen.getByRole('button', { name: '开启临时对话' })
    expect(temporaryToggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(temporaryToggle)
    expect(screen.getByRole('button', { name: '退出临时对话' })).toHaveClass('is-active')
    expect(screen.getByRole('status')).toHaveTextContent('临时对话不会保存到历史记录。')
    expect(screen.getByRole('button', { name: '退出临时对话模式' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '输入消息' }), '这条消息不应保存')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => {
      expect(chat.sendTemporary).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '这条消息不应保存',
          history: [],
          model: 'gpt-4o',
        })
      )
    })
    expect(chat.createConversation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '分享对话' })).toBeDisabled()
  })

  it('exposes a stop action for the active streaming conversation', async () => {
    const user = userEvent.setup()
    chat.streamState.streams['conversation-1'] = makeStreamingState()
    render(<App />)

    await screen.findByRole('button', { name: '停止生成' })
    await user.click(screen.getByRole('button', { name: '停止生成' }))

    expect(chat.stop).toHaveBeenCalledWith('conversation-1')
  })

  it('marks a background conversation as running and stops that exact conversation', async () => {
    const user = userEvent.setup()
    chat.conversations = [
      ...chat.conversations,
      {
        id: 'conversation-2',
        title: '新对话',
        model: 'gpt-4o',
        isPinned: false,
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]
    chat.streamState.streams['conversation-2'] = {
      ...makeStreamingState(),
      conversationId: 'conversation-2',
    }
    render(<App />)

    expect(screen.getByRole('status', { name: '新对话 正在生成' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '停止生成：新对话' }))

    expect(chat.stop).toHaveBeenCalledWith('conversation-2')
  })

  it('aligns the sidebar account section with Web and opens settings', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('桌面用户')).toBeInTheDocument()
    expect(screen.getByText('desktop@example.com')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开个人设置' }))
    await user.click(screen.getByRole('button', { name: '打开快捷设置' }))
    await user.click(screen.getByRole('menuitem', { name: '个人设置' }))

    expect(window.yuanai.window.openSettings).toHaveBeenCalledTimes(2)
  })

  it('localizes conversation date groups while keeping the product name fixed', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    chat.conversations = [
      {
        id: 'conversation-yesterday',
        title: 'Yesterday conversation',
        model: 'gpt-4o',
        isPinned: false,
        lastMessageAt: yesterday.toISOString(),
        createdAt: yesterday.toISOString(),
      },
    ]
    await changeDesktopLanguage('en')
    render(<App />)

    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('元AI', { exact: true })).toBeInTheDocument()
  })

  it('provides the Web-aligned quick theme and logout actions for authenticated users', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开快捷设置' }))
    expect(screen.getByRole('menu', { name: '快捷设置' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '切换深色模式' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))

    await waitFor(() => expect(chat.logout).toHaveBeenCalledOnce())
    expect(screen.queryByRole('menu', { name: '快捷设置' })).not.toBeInTheDocument()
  })

  it('starts voice input and appends a transcript without sending it', async () => {
    const user = userEvent.setup()
    render(<App />)

    const voiceButton = screen.getByRole('button', { name: '语音输入' })
    expect(voiceButton).toBeEnabled()
    await user.click(voiceButton)
    expect(voiceInput.value.start).toHaveBeenCalledOnce()

    act(() => voiceInput.onTranscript?.('仅写入草稿'))

    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue('仅写入草稿')
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('shows voice failures in a temporary top-right toast without using the chat alert', () => {
    vi.useFakeTimers()
    render(<App />)

    act(() => voiceInput.onError?.('未授权使用麦克风，请点击允许'))

    const toast = screen.getByRole('alert')
    expect(toast).toHaveClass('desktop-chat__toast')
    expect(toast).toHaveTextContent('未授权使用麦克风，请点击允许')
    expect(document.querySelector('.desktop-chat__alert')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4_000))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses an in-app dialog to allow or reject a desktop microphone request', async () => {
    const user = userEvent.setup()
    render(<App />)

    act(() => {
      desktop.mediaPermissionListener?.({
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        mediaType: 'audio',
      })
    })

    expect(screen.getByRole('alertdialog', { name: '允许使用麦克风？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '拒绝' }))
    expect(desktop.respondMediaPermission).toHaveBeenCalledWith({
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      granted: false,
    })

    act(() => {
      desktop.mediaPermissionListener?.({
        requestId: '650e8400-e29b-41d4-a716-446655440000',
        mediaType: 'audio',
      })
    })
    await user.click(screen.getByRole('button', { name: '允许' }))
    expect(desktop.respondMediaPermission).toHaveBeenLastCalledWith({
      requestId: '650e8400-e29b-41d4-a716-446655440000',
      granted: true,
    })
  })

  it('opens the dedicated login window from the unauthenticated sidebar account', async () => {
    const user = userEvent.setup()
    auth.user = null
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开登录窗口' }))

    expect(window.yuanai.window.openLogin).toHaveBeenCalledOnce()
  })

  it('disables message sending controls until the user signs in', () => {
    auth.user = null
    render(<App />)

    expect(screen.getByRole('button', { name: '新建会话' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '输入消息' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveAttribute(
      'placeholder',
      '请先登录，开始与 AI 对话'
    )
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled()
    const composerWebSearch = screen
      .getAllByRole('button', { name: '联网搜索' })
      .find((button) => button.hasAttribute('aria-pressed'))
    if (!composerWebSearch) throw new Error('未找到输入框工具栏的联网搜索按钮')
    expect(composerWebSearch).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
  })

  it('provides the Web-aligned quick theme and login actions for unauthenticated users', async () => {
    const user = userEvent.setup()
    auth.user = null
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开快捷设置' }))
    expect(screen.getByRole('menu', { name: '快捷设置' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: '切换深色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(prefs.setTheme).toHaveBeenCalledWith('dark')
    expect(window.yuanai.appearance.apply).toHaveBeenCalledWith('dark')
    expect(chat.updatePreferences).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: '去登录' }))
    expect(window.yuanai.window.openLogin).toHaveBeenCalledOnce()
  })

  it('grows the composer with its content and never enables manual resizing', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByRole('textbox', { name: '输入消息' })
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 144 })

    await user.type(input, '自动增长')

    expect(input).toHaveStyle({ height: '144px' })
    expect(input).toHaveStyle({ overflowY: 'hidden' })
  })

  it('only enables composer scrolling after content exceeds its capped height', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByRole('textbox', { name: '输入消息' })
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 264 })

    await user.type(input, '超长输入')

    expect(input).toHaveStyle({ height: '200px', overflowY: 'auto' })
  })

  it('keeps the Web-aligned empty state usable after collapsing the sidebar', async () => {
    const user = userEvent.setup()
    chat.conversations = []
    chat.messages = []
    render(<App />)

    const sidebarToggle = screen.getByRole('button', { name: '折叠侧边栏' })
    expect(sidebarToggle.parentElement).toHaveClass('desktop-chat__header-side')

    await user.click(sidebarToggle)
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创意写作' }))
    expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue(
      '帮我写一个关于时间旅行的科幻短篇故事'
    )
  })

  it('removes conversation actions while the sidebar is collapsed', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('button', { name: '更多会话操作' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更多会话操作' })).not.toBeInTheDocument()
  })

  it('uses the custom model menu and sends uploaded attachment IDs with the stream', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '选择模型：GPT-4o' }))
    await user.click(screen.getByRole('option', { name: '选择 GPT-4.1 mini' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型：GPT-4.1 mini' })).toBeInTheDocument()
      expect(chat.updateConversation).toHaveBeenCalledWith({
        id: 'conversation-1',
        model: 'gpt-4.1-mini',
      })
    })

    const file = new File(['desktop attachment'], 'notes.txt', { type: 'text/plain' })
    await user.upload(screen.getByTestId('attachment-input'), file)
    expect(screen.getByText('notes.txt')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '输入消息' }), '请分析附件')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => {
      expect(chat.uploadFileSmart).toHaveBeenCalledWith(file, expect.any(Object))
      expect(chat.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '请分析附件',
          fileIds: ['file-1'],
          model: 'gpt-4.1-mini',
        })
      )
    })
  })

  it('opens the attachment popup and queues files returned by the native selector', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['desktop system attachment'], { type: 'text/markdown' })
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      blob: () => Promise.resolve(blob),
      ok: true,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    desktop.openFiles.mockResolvedValue([
      {
        name: 'system-notes.md',
        url: 'yuanai-file://selected/550e8400-e29b-41d4-a716-446655440000',
      },
    ])
    render(<App />)

    await user.click(screen.getByRole('button', { name: '添加附件' }))
    expect(screen.getByRole('menu', { name: '添加附件' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '上传文件' }))

    await waitFor(() => expect(screen.getByText('system-notes.md')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      'yuanai-file://selected/550e8400-e29b-41d4-a716-446655440000'
    )
  })

  it('aligns the attachment menu with all Web capture entry points', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '添加附件' }))

    expect(screen.getByRole('menuitem', { name: '上传文件' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '截屏' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '摄像头拍照' })).toBeInTheDocument()
  })

  it('adds a selected screen capture to the attachment tray without exposing a native path', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['screen'], { type: 'image/png' })
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({
      blob: () => Promise.resolve(blob),
      ok: true,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    desktop.listScreenSources.mockResolvedValue([
      {
        id: 'screen:0:0',
        name: '主显示器',
        thumbnailDataUrl: 'data:image/png;base64,c2NyZWVu',
      },
    ])
    render(<App />)

    await user.click(screen.getByRole('button', { name: '添加附件' }))
    await user.click(screen.getByRole('menuitem', { name: '截屏' }))

    expect(await screen.findByRole('dialog', { name: '选择截屏来源' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择截屏来源：主显示器' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择截屏来源' })).toBeNull())
    expect(
      screen.getByRole('button', {
        name: /^移除附件 screenshot-.*\.png$/,
      })
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('data:image/png;base64,c2NyZWVu')
  })

  it('prevents sending attachments through a model that does not support files', async () => {
    const user = userEvent.setup()
    chat.models = [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: 'deepseek',
        description: '快速响应，高性价比',
        supportsVision: false,
        supportsFiles: false,
        contextLength: 64000,
        isDefault: true,
      },
    ]
    render(<App />)

    const file = new File(['image'], 'capture.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('attachment-input'), file)
    await user.type(screen.getByRole('textbox', { name: '输入消息' }), '分析这张图片')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '当前模型不支持图片识别，请切换至支持视觉的模型后发送'
    )
    expect(chat.send).not.toHaveBeenCalled()
  })
})
