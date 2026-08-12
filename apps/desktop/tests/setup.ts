import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { vi } from 'vitest'

vi.mock('react-syntax-highlighter', () => ({
  PrismAsyncLight: ({
    children,
    className,
    'data-code-rendering': dataCodeRendering,
  }: {
    children: string
    className?: string
    'data-code-rendering'?: 'syntax'
  }) =>
    createElement(
      'pre',
      { className, 'data-code-rendering': dataCodeRendering },
      createElement('code', null, children)
    ),
}))
