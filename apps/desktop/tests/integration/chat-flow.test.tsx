import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setApiBaseUrl } from '@yuanai/core/api'
import { useChatStore, useAuthStore } from '@yuanai/core/stores'
import { Role, type Conversation, type Message } from '@yuanai/types'

import { App } from '../../src/renderer/main/App'

const API_BASE_URL = 'http://desktop-chat.test/api/v1'

const server = setupServer()
let conversations: Conversation[] = []
let messagesByConversation: Record<string, Message[]> = {}
let receivedStreamRequest: { conversationId: string; content: string; model: string } | null = null

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

beforeAll(() => {
  server.use(
    http.get(`${API_BASE_URL}/chat/conversations`, () =>
      HttpResponse.json({ conversations, nextCursor: null, hasMore: false })
    ),
    http.post(`${API_BASE_URL}/chat/conversations`, async ({ request }) => {
      const body = (await request.json()) as { model: string; title?: string }
      const conversation: Conversation = {
        id: 'conversation-1',
        title: body.title ?? '新对话',
        model: body.model,
        isPinned: false,
        lastMessageAt: null,
        createdAt: '2026-08-10T08:00:00.000Z',
      }
      conversations = [conversation, ...conversations]
      messagesByConversation[conversation.id] = []
      return HttpResponse.json(conversation, { status: 201 })
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
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(async () => {
  conversations = []
  messagesByConversation = {}
  receivedStreamRequest = null
  setApiBaseUrl(API_BASE_URL)
  useAuthStore.setState({ accessToken: 'desktop-test-token', refreshToken: null, user: null })
  useChatStore.getState().finalizeStream()
  await useAuthStore.persist.clearStorage()
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())

describe('desktop chat integration', () => {
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
})
