import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CodeHighlight } from './CodeHighlight'

describe('CodeHighlight', () => {
  it('keeps large source blocks in lightweight plain-text mode', () => {
    const code = Array.from({ length: 301 }, (_value, index) => `line ${index + 1}`).join('\n')
    const { container } = render(<CodeHighlight lang="javascript" code={code} />)

    const source = container.querySelector('[data-code-rendering="plain"]')
    expect(source).toHaveTextContent('line 301')
  })

  it('uses lightweight plain text when rendering is deferred', () => {
    const { container } = render(<CodeHighlight lang="javascript" code="const answer = 42" defer />)

    expect(container.querySelector('[data-code-rendering="plain"]')).toHaveTextContent(
      'const answer = 42'
    )
  })
})
