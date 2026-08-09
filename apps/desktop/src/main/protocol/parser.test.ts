import { describe, expect, it } from 'vitest'

import { parseDeepLink } from './parser'

describe('parseDeepLink', () => {
  it('parses valid chat and OAuth callback links', () => {
    expect(parseDeepLink('yuanai://chat/550e8400-e29b-41d4-a716-446655440000')).toEqual({
      type: 'chat',
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(parseDeepLink(`yuanai://oauth/callback?code=${'a'.repeat(43)}`)).toEqual({
      type: 'oauth',
      code: 'a'.repeat(43),
    })
  })

  it.each([
    'yuanai://chat/not-a-uuid',
    'yuanai://oauth/callback?access_token=secret',
    `yuanai://oauth/callback?code=${'a'.repeat(42)}`,
    `yuanai://oauth/callback?code=${'a'.repeat(43)}&code=${'b'.repeat(43)}`,
    'yuanai://unknown/path',
    'yuanai://chat/550e8400-e29b-41d4-a716-446655440000#fragment',
  ])('rejects unsafe deep link %s', (value) => {
    expect(parseDeepLink(value)).toBeNull()
  })
})
