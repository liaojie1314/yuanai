import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server } from '../../../tests/mocks/server.js'
import { API_BASE_URL } from '../../api/client.js'
import { useAuthStore } from '../../stores/auth.store.js'
import { useCreateSkill, useSkills } from '../useSkills.js'

const skill = {
  id: 'skill-1',
  userId: 'user-1',
  slug: 'yuanai.research.brief',
  name: 'Research Brief',
  description: 'Build a cited brief',
  currentVersionId: null,
  versions: [],
  installations: [],
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
}

function withProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
})

describe('useSkills', () => {
  it('loads the authenticated list and refreshes after creating a draft', async () => {
    let listCalls = 0
    server.use(
      http.get(`${API_BASE_URL}/skills`, () => {
        listCalls += 1
        return HttpResponse.json([skill])
      }),
      http.post(`${API_BASE_URL}/skills`, () => HttpResponse.json(skill, { status: 201 }))
    )
    const wrapper = withProvider()
    const { result } = renderHook(() => useSkills(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    const { result: createResult } = renderHook(() => useCreateSkill(), { wrapper })
    let createdId: string | undefined
    await act(async () => {
      const created = await createResult.current.mutateAsync({
        manifest: 'id: skill',
        skillMd: '# Skill',
      })
      createdId = created.id
    })
    expect(createdId).toBe('skill-1')
    await waitFor(() => expect(listCalls).toBe(2))
  })

  it('does not request skills without an access token', async () => {
    useAuthStore.getState().clearAuth()
    let called = 0
    server.use(
      http.get(`${API_BASE_URL}/skills`, () => {
        called += 1
        return HttpResponse.json([])
      })
    )
    renderHook(() => useSkills(), { wrapper: withProvider() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(called).toBe(0)
  })
})
