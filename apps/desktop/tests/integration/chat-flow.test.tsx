import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setApiBaseUrl } from '@yuanai/core/api'
import { useChatStore, useAuthStore } from '@yuanai/core/stores'
import { Role, type Conversation, type Message, type User } from '@yuanai/types'

import { App } from '../../src/renderer/main/App'

const API_BASE_URL = 'http://desktop-chat.test/api/v1'

const AUTHENTICATED_USER: User = {
  id: 'desktop-test-user',
  email: 'desktop@example.com',
  username: '桌面测试用户',
  avatarUrl: null,
  createdAt: '2026-08-10T08:00:00.000Z',
}

let conversations: Conversation[] = []
let messagesByConversation: Record<string, Message[]> = {}
let receivedStreamRequest: { conversationId: string; content: string; model: string } | null = null
let nextConversationNumber = 1
let renamedConversationId: string | null = null
let removedConversationId: string | null = null
let revokedShareConversationId: string | null = null
let shareLink: {
  shareToken: string
  titleSnapshot: string
  createdAt: string
  expiresAt: string | null
  hasPassword: boolean
} | null = null
let receivedShareOptions: { expiresInDays: number | null; password: string } | null = null

function createStreamResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
        )
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

const server = setupServer(
  http.get(`${API_BASE_URL}/chat/conversations`, () =>
    HttpResponse.json({ conversations, nextCursor: null, hasMore: false })
  ),
  http.post(`${API_BASE_URL}/chat/conversations`, async ({ request }) => {
    const body = (await request.json()) as { model: string; title?: string }
    const conversation: Conversation = {
      id: `conversation-${nextConversationNumber++}`,
      title: body.title ?? '新对话',
      titleSource: 'default',
      titleGeneratedAt: null,
      model: body.model,
      isPinned: false,
      lastMessageAt: null,
      createdAt: '2026-08-10T08:00:00.000Z',
    }
    conversations = [conversation, ...conversations]
    messagesByConversation[conversation.id] = []
    return HttpResponse.json(conversation, { status: 201 })
  }),
  http.patch(`${API_BASE_URL}/chat/conversations/:conversationId`, async ({ params, request }) => {
    const conversationId = params['conversationId']
    if (typeof conversationId !== 'string') return new HttpResponse(null, { status: 404 })

    const body = (await request.json()) as { title?: string }
    const conversation = conversations.find((item) => item.id === conversationId)
    if (!conversation) return new HttpResponse(null, { status: 404 })

    const updatedConversation = { ...conversation, title: body.title ?? conversation.title }
    conversations = conversations.map((item) =>
      item.id === conversationId ? updatedConversation : item
    )
    renamedConversationId = conversationId
    return HttpResponse.json(updatedConversation)
  }),
  http.delete(`${API_BASE_URL}/chat/conversations/:conversationId`, ({ params }) => {
    const conversationId = params['conversationId']
    if (typeof conversationId !== 'string') return new HttpResponse(null, { status: 404 })

    conversations = conversations.filter((item) => item.id !== conversationId)
    delete messagesByConversation[conversationId]
    removedConversationId = conversationId
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${API_BASE_URL}/chat/conversations/:conversationId/share`, ({ params }) => {
    if (typeof params['conversationId'] !== 'string' || !shareLink) {
      return HttpResponse.json({ detail: '分享链接不存在' }, { status: 404 })
    }
    return HttpResponse.json(shareLink)
  }),
  http.post(
    `${API_BASE_URL}/chat/conversations/:conversationId/share`,
    async ({ params, request }) => {
      const conversationId = params['conversationId']
      if (typeof conversationId !== 'string') return new HttpResponse(null, { status: 404 })
      receivedShareOptions = (await request.json()) as {
        expiresInDays: number | null
        password: string
      }
      shareLink = {
        shareToken: 'desktop-share-token',
        titleSnapshot: conversations.find((item) => item.id === conversationId)?.title ?? '新对话',
        createdAt: '2026-08-10T08:00:00.000Z',
        expiresAt: '2026-08-17T08:00:00.000Z',
        hasPassword: receivedShareOptions.password.length > 0,
      }
      return HttpResponse.json(shareLink)
    }
  ),
  http.delete(`${API_BASE_URL}/chat/conversations/:conversationId/share`, ({ params }) => {
    const conversationId = params['conversationId']
    if (typeof conversationId !== 'string') return new HttpResponse(null, { status: 404 })
    revokedShareConversationId = conversationId
    shareLink = null
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${API_BASE_URL}/chat/conversations/:conversationId/messages`, ({ params }) => {
    const conversationId = params['conversationId']
    if (typeof conversationId !== 'string') return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({
      messages: messagesByConversation[conversationId] ?? [],
      nextCursor: null,
      hasMore: false,
    })
  }),
  http.get(`${API_BASE_URL}/models`, () =>
    HttpResponse.json({
      models: [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: 'openai',
          description: '测试模型',
          supports_vision: true,
          supports_files: true,
          context_length: 128000,
          is_default: true,
        },
        {
          id: 'gpt-4.1-mini',
          name: 'GPT-4.1 mini',
          provider: 'openai',
          description: '快速响应模型',
          supports_vision: true,
          supports_files: true,
          context_length: 128000,
          is_default: false,
        },
      ],
    })
  ),
  http.post(`${API_BASE_URL}/chat/stream`, async ({ request }) => {
    const body = (await request.json()) as {
      conversation_id: string
      model: string
      message: { content: string }
    }
    receivedStreamRequest = {
      conversationId: body.conversation_id,
      content: body.message.content,
      model: body.model,
    }
    messagesByConversation[body.conversation_id] = [
      {
        id: 'message-user-1',
        role: Role.User,
        content: body.message.content,
        files: [],
        createdAt: '2026-08-10T08:00:02.000Z',
      },
      {
        id: 'message-assistant-1',
        role: Role.Assistant,
        content: '已收到回复',
        files: [],
        createdAt: '2026-08-10T08:00:03.000Z',
      },
    ]
    return createStreamResponse([
      {
        event: 'message_start',
        data: { user_message_id: 'message-user-1', assistant_message_id: 'message-assistant-1' },
      },
      { event: 'content_delta', data: { token: '已收到' } },
      { event: 'content_delta', data: { token: '回复' } },
    ])
  })
)

function renderChatApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

function getConversationActionButton(label: string, index: number): HTMLElement {
  const button = screen.getAllByRole('button', { name: label })[index]
  if (!button) throw new Error(`未找到第 ${index + 1} 个${label}按钮`)
  return button
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(async () => {
  conversations = []
  messagesByConversation = {}
  receivedStreamRequest = null
  nextConversationNumber = 1
  renamedConversationId = null
  removedConversationId = null
  revokedShareConversationId = null
  shareLink = null
  receivedShareOptions = null
  setApiBaseUrl(API_BASE_URL)
  useAuthStore.setState({
    accessToken: 'desktop-test-token',
    refreshToken: null,
    user: AUTHENTICATED_USER,
  })
  useChatStore.getState().finalizeStream()
  await useAuthStore.persist.clearStorage()
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      runtime: {
        getConfig: async () => ({
          apiBaseUrl: API_BASE_URL,
          assetOrigins: [],
          webBaseUrl: 'http://desktop-web.test',
        }),
      },
    },
  })
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())

describe('desktop chat integration', () => {
  it('loads, switches, renames, deletes, and creates conversations through the Core API', async () => {
    const user = userEvent.setup()
    conversations = [
      {
        id: 'conversation-1',
        title: '默认会话',
        titleSource: 'manual',
        titleGeneratedAt: '2026-08-10T08:00:00.000Z',
        model: 'gpt-4o',
        isPinned: false,
        lastMessageAt: '2026-08-10T08:00:00.000Z',
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'conversation-2',
        title: '快速模型会话',
        titleSource: 'manual',
        titleGeneratedAt: '2026-08-09T08:00:00.000Z',
        model: 'gpt-4.1-mini',
        isPinned: false,
        lastMessageAt: '2026-08-09T08:00:00.000Z',
        createdAt: '2026-08-09T08:00:00.000Z',
      },
    ]
    messagesByConversation = {
      'conversation-1': [
        {
          id: 'message-1',
          role: Role.Assistant,
          content: '默认会话消息',
          files: [],
          createdAt: '2026-08-10T08:00:00.000Z',
        },
      ],
      'conversation-2': [
        {
          id: 'message-2',
          role: Role.Assistant,
          content: '快速模型会话消息',
          files: [],
          createdAt: '2026-08-09T08:00:00.000Z',
        },
      ],
    }
    nextConversationNumber = 3
    renderChatApp()

    expect(await screen.findByText('默认会话消息')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '快速模型会话' }))
    expect(await screen.findByText('快速模型会话消息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择模型：GPT-4.1 mini' })).toBeInTheDocument()

    await user.click(getConversationActionButton('更多会话操作', 1))
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }))
    const titleInput = screen.getByRole('textbox', { name: '会话标题' })
    await user.clear(titleInput)
    await user.type(titleInput, '已重命名会话')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(renamedConversationId).toBe('conversation-2'))
    expect(await screen.findByRole('button', { name: '已重命名会话' })).toBeInTheDocument()

    await user.click(getConversationActionButton('更多会话操作', 1))
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))
    expect(screen.getByRole('alertdialog', { name: '删除会话？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(removedConversationId).toBe('conversation-2'))
    expect(screen.queryByRole('button', { name: '已重命名会话' })).not.toBeInTheDocument()
    expect(await screen.findByText('默认会话消息')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(await screen.findByRole('button', { name: '新对话' })).toBeInTheDocument()
  })

  it('creates a conversation, streams a reply, and renders the persisted messages', async () => {
    const user = userEvent.setup()
    renderChatApp()

    await user.click(await screen.findByRole('button', { name: '新建会话' }))
    await user.type(screen.getByRole('textbox', { name: '输入消息' }), '你好，元AI')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => {
      expect(receivedStreamRequest).toEqual({
        conversationId: 'conversation-1',
        content: '你好，元AI',
        model: 'gpt-4o',
      })
    })
    expect(await screen.findByText('已收到回复')).toBeInTheDocument()
    expect(screen.getByText('你好，元AI')).toBeInTheDocument()
  })

  it('creates a protected share link and revokes it through the Core API', async () => {
    const user = userEvent.setup()
    conversations = [
      {
        id: 'conversation-1',
        title: '待分享会话',
        titleSource: 'manual',
        titleGeneratedAt: '2026-08-10T08:00:00.000Z',
        model: 'gpt-4o',
        isPinned: false,
        lastMessageAt: '2026-08-10T08:00:00.000Z',
        createdAt: '2026-08-10T08:00:00.000Z',
      },
    ]
    renderChatApp()

    await user.click(await screen.findByRole('button', { name: '分享对话' }))
    expect(await screen.findByRole('dialog', { name: '分享此对话' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '7 天' }))
    await user.click(screen.getByRole('switch', { name: '启用访问密码' }))
    await user.type(screen.getByPlaceholderText('设置 4 位以上密码'), 'desktop-secret')
    await user.click(screen.getByRole('button', { name: '生成分享链接' }))

    await waitFor(() => {
      expect(receivedShareOptions).toEqual({ expiresInDays: 7, password: 'desktop-secret' })
    })
    expect(
      await screen.findByDisplayValue('http://desktop-web.test/share/desktop-share-token')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销分享' }))
    expect(screen.getByRole('alertdialog', { name: '撤销分享链接？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '撤销' }))

    await waitFor(() => expect(revokedShareConversationId).toBe('conversation-1'))
    expect(await screen.findByText('分享链接已撤销')).toBeInTheDocument()
  })
})
