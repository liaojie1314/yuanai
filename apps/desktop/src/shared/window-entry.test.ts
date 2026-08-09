import { describe, expect, it } from 'vitest'

import { RENDERER_ENTRIES } from './window-entry'

describe('RENDERER_ENTRIES', () => {
  it('declares each Phase 4 renderer exactly once', () => {
    expect(RENDERER_ENTRIES).toEqual(['main', 'login', 'settings', 'about', 'artifact', 'oauth'])
    expect(new Set(RENDERER_ENTRIES).size).toBe(RENDERER_ENTRIES.length)
  })
})
