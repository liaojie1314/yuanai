import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeAll, afterAll, vi } from 'vitest'
import { server } from './mocks/server.js'

// PrismAsyncLight 异步加载语言包后会 forceUpdate，落在测试的 act() 边界之外产生噪音警告；
// 单测只关心 textContent/按钮等外围行为，不关心真实高亮效果，桩成同步纯文本渲染
vi.mock('react-syntax-highlighter', () => ({
  PrismAsyncLight: ({ children, className }: { children: string; className?: string }) =>
    createElement('pre', { className }, createElement('code', null, children)),
}))

// jsdom does not implement matchMedia — provide a minimal stub
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

afterEach(() => {
  cleanup()
})

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
