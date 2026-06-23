import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:8000/api/v1'

export const mockUser = {
  id: 'user-001',
  email: 'test@example.com',
  username: 'testuser',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
}

export const handlers = [http.get(`${BASE}/auth/me`, () => HttpResponse.json(mockUser))]
