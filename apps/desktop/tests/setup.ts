import '@testing-library/jest-dom/vitest'
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'
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

vi.mock('react-virtuoso', () => {
  interface VirtuosoProps {
    data?: readonly unknown[]
    itemContent?: (index: number, item: unknown) => ReactNode
    components?: {
      Header?: ComponentType
      Footer?: ComponentType
    }
  }

  function Virtuoso({ data = [], itemContent, components }: VirtuosoProps): ReactNode {
    const Header = components?.Header
    const Footer = components?.Footer
    return createElement(
      'div',
      null,
      Header ? createElement(Header) : null,
      ...data.map((item, index) =>
        createElement(Fragment, { key: index }, itemContent?.(index, item) ?? null)
      ),
      Footer ? createElement(Footer) : null
    )
  }

  return { Virtuoso }
})
