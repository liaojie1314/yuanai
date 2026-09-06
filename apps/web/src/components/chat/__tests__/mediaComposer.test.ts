import { describe, expect, it } from 'vitest'

import {
  buildMediaTaskInput,
  mediaComposerAllowsAttachments,
  MUSIC_DURATION_SECONDS,
} from '../mediaComposer'

describe('media composer contract', () => {
  it('builds the fixed music payload without attachments', () => {
    expect(buildMediaTaskInput('conv-1', 'music', '舒缓钢琴', {}, ['file-1'])).toEqual({
      conversationId: 'conv-1',
      type: 'music',
      prompt: '舒缓钢琴',
      options: { durationSeconds: MUSIC_DURATION_SECONDS },
      sourceFileIds: [],
    })
  })

  it('disables attachments only for music mode', () => {
    expect(mediaComposerAllowsAttachments('music')).toBe(false)
    expect(mediaComposerAllowsAttachments('image')).toBe(true)
    expect(mediaComposerAllowsAttachments('video')).toBe(true)
  })
})
