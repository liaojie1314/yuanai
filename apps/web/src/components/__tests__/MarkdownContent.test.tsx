import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MarkdownContent from '@/components/MarkdownContent'

// navigator.clipboard not available in jsdom
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
})

describe('MarkdownContent', () => {
  // ── Plain text ─────────────────────────────────────────────────

  it('renders plain text', () => {
    render(<MarkdownContent content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('wraps output in md-body class', () => {
    const { container } = render(<MarkdownContent content="text" />)
    expect(container.querySelector('.md-body')).toBeInTheDocument()
  })

  it('renders empty content without error', () => {
    const { container } = render(<MarkdownContent content="" />)
    expect(container.querySelector('.md-body')).toBeInTheDocument()
  })

  // ── Inline formatting ──────────────────────────────────────────

  it('renders **bold** as <strong>', () => {
    const { container } = render(<MarkdownContent content="**bold text**" />)
    const strong = container.querySelector('strong')
    expect(strong).toBeInTheDocument()
    expect(strong?.textContent).toBe('bold text')
  })

  it('renders _italic_ as <em>', () => {
    const { container } = render(<MarkdownContent content="_italic text_" />)
    expect(container.querySelector('em')).toBeInTheDocument()
  })

  it('renders `inline code` as <code> with ch-inline-code class', () => {
    const { container } = render(<MarkdownContent content="Use `console.log()`" />)
    const code = container.querySelector('code.ch-inline-code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toBe('console.log()')
  })

  it('renders ~~strikethrough~~ via GFM', () => {
    const { container } = render(<MarkdownContent content="~~deleted~~" />)
    expect(container.querySelector('del')).toBeInTheDocument()
  })

  // ── Headings ───────────────────────────────────────────────────

  it('renders # Heading 1 as <h1>', () => {
    const { container } = render(<MarkdownContent content="# H1" />)
    expect(container.querySelector('h1')?.textContent).toBe('H1')
  })

  it('renders ## Heading 2 as <h2>', () => {
    const { container } = render(<MarkdownContent content="## H2" />)
    expect(container.querySelector('h2')?.textContent).toBe('H2')
  })

  it('renders ### Heading 3 as <h3>', () => {
    const { container } = render(<MarkdownContent content="### H3" />)
    expect(container.querySelector('h3')?.textContent).toBe('H3')
  })

  // ── Lists ──────────────────────────────────────────────────────

  it('renders unordered list items', () => {
    const { container } = render(<MarkdownContent content={'- item A\n- item B\n- item C'} />)
    expect(container.querySelector('ul')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(3)
  })

  it('renders ordered list items', () => {
    const { container } = render(<MarkdownContent content={'1. first\n2. second'} />)
    expect(container.querySelector('ol')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  // ── Code blocks ────────────────────────────────────────────────

  it('renders fenced code block as ch-code-block', () => {
    const { container } = render(<MarkdownContent content={'```\nsome code\n```'} />)
    expect(container.querySelector('.ch-code-block')).toBeInTheDocument()
  })

  it('shows language label in code block header', () => {
    render(<MarkdownContent content={"```javascript\nconsole.log('hi')\n```"} />)
    expect(screen.getByText('javascript')).toBeInTheDocument()
  })

  it('shows "Code" as fallback when no language specified', () => {
    render(<MarkdownContent content={'```\nno lang\n```'} />)
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('code block has copy button that calls clipboard.writeText', async () => {
    render(<MarkdownContent content={"```python\nprint('hello')\n```"} />)
    const copyBtn = screen.getByRole('button', { name: /复制代码/ })
    expect(copyBtn).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(copyBtn)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("print('hello')")
  })

  it('does not wrap CodeBlock in extra <pre> tag', () => {
    const { container } = render(<MarkdownContent content={'```\ncode\n```'} />)
    // The custom pre renderer strips the outer <pre>; code block is ch-code-block
    const pre = container.querySelector('.ch-code-block pre')
    expect(pre).toBeInTheDocument()
    // No extra <pre> wrapping the whole block
    expect(container.querySelectorAll('pre')).toHaveLength(1)
  })

  // ── Block elements ─────────────────────────────────────────────

  it('renders > blockquote', () => {
    const { container } = render(<MarkdownContent content="> quoted text" />)
    expect(container.querySelector('blockquote')).toBeInTheDocument()
  })

  it('renders horizontal rule', () => {
    const { container } = render(<MarkdownContent content={'---'} />)
    expect(container.querySelector('hr')).toBeInTheDocument()
  })

  it('renders link with href', () => {
    const { container } = render(<MarkdownContent content="[Click here](https://example.com)" />)
    const a = container.querySelector('a')
    expect(a).toBeInTheDocument()
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.textContent).toBe('Click here')
  })

  // ── GFM table ─────────────────────────────────────────────────

  it('renders GFM table with <th> headers', () => {
    const md = `| Name | Value |\n|------|-------|\n| foo  | 1     |`
    const { container } = render(<MarkdownContent content={md} />)
    expect(container.querySelector('table')).toBeInTheDocument()
    expect(container.querySelector('th')).toBeInTheDocument()
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  // ── Streaming cursor ───────────────────────────────────────────

  it('shows .ch-cursor when streaming=true', () => {
    const { container } = render(<MarkdownContent content="typing..." streaming={true} />)
    expect(container.querySelector('.ch-cursor')).toBeInTheDocument()
  })

  it('no .ch-cursor when streaming=false', () => {
    const { container } = render(<MarkdownContent content="done" streaming={false} />)
    expect(container.querySelector('.ch-cursor')).not.toBeInTheDocument()
  })

  it('no .ch-cursor when streaming prop is omitted', () => {
    const { container } = render(<MarkdownContent content="text" />)
    expect(container.querySelector('.ch-cursor')).not.toBeInTheDocument()
  })

  // ── Complex mixed content ──────────────────────────────────────

  it('renders mixed markdown: heading + bold + list', () => {
    const content = [
      '## Summary',
      '',
      'Key points:',
      '',
      '- **Performance**: Use `React.memo`',
      '- **Caching**: Use `useMemo`',
    ].join('\n')
    const { container } = render(<MarkdownContent content={content} />)
    expect(container.querySelector('h2')).toBeInTheDocument()
    expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('li').length).toBe(2)
  })
})
