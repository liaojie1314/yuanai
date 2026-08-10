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
  send: vi.fn(),
  stop: vi.fn(),
  streamState: {
    optimisticUserMsg: null as string | null,
    streamingContent: '',
    streamingConvId: null as string | null,
    streamingThink: '',
  },
  updateConversation: vi.fn(),
}))

vi.mock('@yuanai/core/hooks', () => ({
  useConversations: () => ({ data: chat.conversations, isLoading: false }),
  useCreateConversation: () => ({ isPending: false, mutateAsync: chat.createConversation }),
  useDeleteConversation: () => ({ isPending: false, mutateAsync: chat.deleteConversation }),
  useMessages: () => ({ data: chat.messages, isLoading: false }),
  useModels: () => ({
    data: [
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
    ],
  }),
  useStream: () => ({ send: chat.send, stop: chat.stop }),
  useUpdateConversation: () => ({ isPending: false, mutateAsync: chat.updateConversation }),
}))

vi.mock('@yuanai/core/stores', () => ({
  useChatStore: (selector: (state: typeof chat.streamState) => unknown) =>
    selector(chat.streamState),
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
  chat.conversations = [
    {
      id: 'conversation-1',
      title: '测试会话',
      model: 'gpt-4o',
      isPinned: false,
      lastMessageAt: '2026-08-10T08:00:00.000Z',
      createdAt: '2026-08-10T08:00:00.000Z',
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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

  it('opens the settings and about windows from the sidebar actions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    await user.click(screen.getByRole('button', { name: '关于元AI' }))

    expect(window.yuanai.window.openSettings).toHaveBeenCalledOnce()
    expect(window.yuanai.window.openAbout).toHaveBeenCalledOnce()
  })
})
