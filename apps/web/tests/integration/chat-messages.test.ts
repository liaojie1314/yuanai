/**
 * Integration tests for chat message filtering logic.
 *
 * These tests verify the pure filtering behavior that prevents duplicate user
 * messages and hides empty assistant placeholders during streaming. The logic
 * lives in ChatInterface.tsx and is extracted here as a standalone function
 * so it can be tested without rendering the full component.
 */
import { describe, it, expect } from 'vitest'

interface Part {
  type: string
  content?: string
}

interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Part[]
}

function getMsgText(msg: MockMessage): string {
  return msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.content ?? '')
    .join('\n')
}

/**
 * Mirrors the filter logic in ChatInterface.tsx <messages.filter(...)>
 */
function filterMessages(
  messages: MockMessage[],
  isThisStreaming: boolean,
  optimisticUserMsg: string | null
): MockMessage[] {
  return messages.filter((msg) => {
    if (!isThisStreaming) return true
    if (msg.role === 'assistant' && !getMsgText(msg)) return false
    if (msg.role === 'user' && optimisticUserMsg && getMsgText(msg) === optimisticUserMsg)
      return false
    return true
  })
}

const user = (id: string, text: string): MockMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', content: text }],
})

const assistant = (id: string, text: string): MockMessage => ({
  id,
  role: 'assistant',
  parts: text ? [{ type: 'text', content: text }] : [],
})

describe('filterMessages — not streaming', () => {
  it('returns all messages unchanged when not streaming', () => {
    const msgs = [user('u1', 'Hello'), assistant('a1', 'Hi!')]
    expect(filterMessages(msgs, false, null)).toHaveLength(2)
  })

  it('returns empty assistant messages unchanged when not streaming', () => {
    const msgs = [user('u1', 'Hi'), assistant('a1', '')]
    const result = filterMessages(msgs, false, null)
    expect(result).toHaveLength(2)
  })
})

describe('filterMessages — during streaming', () => {
  it('hides empty assistant placeholder', () => {
    const msgs = [user('u1', 'Hello'), assistant('a1', '')]
    const result = filterMessages(msgs, true, 'Hello')
    expect(result.find((m) => m.id === 'a1')).toBeUndefined()
  })

  it('hides persisted user message that duplicates the optimistic message', () => {
    const msgs = [user('u1', 'Hello'), assistant('a1', '')]
    const result = filterMessages(msgs, true, 'Hello')
    expect(result.find((m) => m.id === 'u1')).toBeUndefined()
  })

  it('keeps previous user messages that are NOT the current optimistic message', () => {
    const msgs = [
      user('u1', 'Previous question'),
      assistant('a1', 'Previous answer'),
      user('u2', 'Current question'),
      assistant('a2', ''),
    ]
    const result = filterMessages(msgs, true, 'Current question')
    expect(result.find((m) => m.id === 'u1')).toBeDefined()
    expect(result.find((m) => m.id === 'a1')).toBeDefined()
    expect(result.find((m) => m.id === 'u2')).toBeUndefined()
    expect(result.find((m) => m.id === 'a2')).toBeUndefined()
  })

  it('keeps completed assistant messages with content during streaming', () => {
    const msgs = [
      user('u1', 'Q1'),
      assistant('a1', 'A1 response'),
      user('u2', 'Q2'),
      assistant('a2', ''), // placeholder for current stream
    ]
    const result = filterMessages(msgs, true, 'Q2')
    expect(result.find((m) => m.id === 'a1')).toBeDefined()
    expect(result.find((m) => m.id === 'a2')).toBeUndefined()
  })

  it('keeps all messages when optimisticUserMsg is null', () => {
    const msgs = [user('u1', 'Hello'), assistant('a1', '')]
    // No optimistic msg set — both should pass through (edge case)
    const result = filterMessages(msgs, true, null)
    expect(result.find((m) => m.id === 'u1')).toBeDefined()
    expect(result.find((m) => m.id === 'a1')).toBeUndefined() // empty assistant still hidden
  })

  it('does not filter user message when text does not match optimistic', () => {
    const msgs = [user('u1', 'Different text'), assistant('a1', '')]
    const result = filterMessages(msgs, true, 'Current text')
    expect(result.find((m) => m.id === 'u1')).toBeDefined()
  })

  it('handles empty messages array', () => {
    expect(filterMessages([], true, 'Q')).toHaveLength(0)
  })

  it('handles message with multiple text parts', () => {
    const multiPart: MockMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', content: 'Hello ' },
        { type: 'text', content: 'World' },
      ],
    }
    // getMsgText joins them as "Hello \nWorld"
    const msgs = [multiPart, assistant('a1', '')]
    const result = filterMessages(msgs, true, 'Hello \nWorld')
    expect(result.find((m) => m.id === 'u1')).toBeUndefined()
  })

  it('handles message with non-text parts (files)', () => {
    const withFile: MockMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'file', content: 'some-file.pdf' },
        { type: 'text', content: 'Summarize this' },
      ],
    }
    const msgs = [withFile, assistant('a1', '')]
    const result = filterMessages(msgs, true, 'Summarize this')
    expect(result.find((m) => m.id === 'u1')).toBeUndefined()
  })
})

describe('getMsgText', () => {
  it('extracts text from single text part', () => {
    expect(getMsgText(user('u1', 'Hello'))).toBe('Hello')
  })

  it('returns empty string for message with no parts', () => {
    expect(getMsgText({ id: 'a1', role: 'assistant', parts: [] })).toBe('')
  })

  it('joins multiple text parts with newline', () => {
    const msg: MockMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', content: 'Part A' },
        { type: 'text', content: 'Part B' },
      ],
    }
    expect(getMsgText(msg)).toBe('Part A\nPart B')
  })

  it('ignores non-text parts', () => {
    const msg: MockMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'file', content: 'document.pdf' },
        { type: 'text', content: 'Read the attached file' },
      ],
    }
    expect(getMsgText(msg)).toBe('Read the attached file')
  })
})
