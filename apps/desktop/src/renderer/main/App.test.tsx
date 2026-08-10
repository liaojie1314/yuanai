import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  deleteConversation: vi.fn(),
  messages: [] as Array<{
    id: string
    role: string
    content: string
    files: []
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
  stop: vi.fn(),
  streamState: {
    optimisticUserMsg: null as string | null,
    streamingContent: '',
    streamingConvId: null as string | null,
    streamingThink: '',
  },
  uploadFileSmart: vi.fn(),
  updateConversation: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  user: null as {
    id: string
    email: string
    username: string
    avatarUrl: string | null
    createdAt: string
  } | null,
}))

const prefs = vi.hoisted(() => ({
  setTheme: vi.fn(),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useConversations: () => ({ data: chat.conversations, isLoading: false }),
  useCreateConversation: () => ({ isPending: false, mutateAsync: chat.createConversation }),
  useDeleteConversation: () => ({ isPending: false, mutateAsync: chat.deleteConversation }),
  useMessages: () => ({ data: chat.messages, isLoading: false }),
  useModels: () => ({ data: chat.models }),
  useStream: () => ({ send: chat.send, stop: chat.stop }),
  useUpdateConversation: () => ({ isPending: false, mutateAsync: chat.updateConversation }),
  uploadFileSmart: chat.uploadFileSmart,
}))

vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
  useChatStore: (selector: (state: typeof chat.streamState) => unknown) =>
    selector(chat.streamState),
  usePrefsStore: (selector: (state: typeof prefs) => unknown) => selector(prefs),
}))

import { App } from './App'

beforeEach(() => {
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      window: {
        openLogin: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openRegister: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openForgot: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openAbout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
  chat.createConversation.mockResolvedValue({
    id: 'conversation-2',
    title: '新对话',
    model: 'gpt-4o',
    isPinned: false,
    lastMessageAt: null,
    createdAt: '2026-08-10T08:00:00.000Z',
  })
  chat.streamState.streamingConvId = null
  chat.streamState.streamingContent = ''
  chat.streamState.streamingThink = ''
  chat.streamState.optimisticUserMsg = null
  chat.uploadFileSmart.mockResolvedValue({ id: 'file-1' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

describe('desktop chat', () => {
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

  it('exposes a stop action for the active streaming conversation', async () => {
    const user = userEvent.setup()
    chat.streamState.streamingConvId = 'conversation-1'
    render(<App />)

    await screen.findByRole('button', { name: '停止生成' })
    await user.click(screen.getByRole('button', { name: '停止生成' }))

    expect(chat.stop).toHaveBeenCalledOnce()
  })

  it('aligns the sidebar account section with Web and opens settings', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('桌面用户')).toBeInTheDocument()
    expect(screen.getByText('desktop@example.com')).toBeInTheDocument()
    expect(screen.getByText('今天')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开个人设置' }))
    await user.click(screen.getByRole('button', { name: '打开设置' }))

    expect(window.yuanai.window.openSettings).toHaveBeenCalledTimes(2)
  })

  it('shows a disabled voice input entry until transcription is available', () => {
    render(<App />)

    const voiceInput = screen.getByRole('button', { name: '语音输入' })
    expect(voiceInput).toBeDisabled()
    expect(voiceInput).toHaveAttribute('title', '语音输入暂未开放')
  })

  it('opens the dedicated login window from the unauthenticated sidebar account', async () => {
    const user = userEvent.setup()
    auth.user = null
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开登录窗口' }))

    expect(window.yuanai.window.openLogin).toHaveBeenCalledOnce()
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
      '帮我写一个关于时间旅行的科幻短篇'
    )
  })

  it('uses the custom model menu and sends uploaded attachment IDs with the stream', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '选择模型：GPT-4o' }))
    await user.click(screen.getByRole('option', { name: '选择 GPT-4.1 mini' }))
    expect(screen.getByRole('button', { name: '选择模型：GPT-4.1 mini' })).toBeInTheDocument()

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
})
