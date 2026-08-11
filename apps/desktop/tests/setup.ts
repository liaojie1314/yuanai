import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { vi } from 'vitest'

vi.mock('react-syntax-highlighter', () => ({
  PrismAsyncLight: ({ children, className }: { children: string; className?: string }) =>
    createElement('pre', { className }, createElement('code', null, children)),
}))
