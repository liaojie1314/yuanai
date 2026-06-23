import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:8000/api/v1'

export const mockUser = {
  id: 'user-001',
  email: 'test@example.com',
  username: 'testuser',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
}

export const handlers = [
  http.get(`${BASE}/auth/me`, () => HttpResponse.json(mockUser)),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'test@example.com' && body.password === 'Test1234!') {
      return HttpResponse.json({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        token_type: 'bearer',
        user: mockUser,
      })
    }
    return HttpResponse.json(
      { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码错误' },
      { status: 401 }
    )
  }),

  http.get(`${BASE}/chat/conversations`, () =>
    HttpResponse.json({ conversations: [], next_cursor: null, has_more: false })
  ),
]
