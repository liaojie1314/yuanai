import { describe, expect, it } from 'vitest'

import { flattenConversationGroups } from './conversation-list-rows'

describe('flattenConversationGroups', () => {
  it('keeps group headers adjacent to their virtualized conversation rows', () => {
    const rows = flattenConversationGroups(
      {
        pinned: [
          {
            id: 'pinned-1',
            title: 'Pinned',
            titleSource: 'manual',
            group: 'pinned',
            isPinned: true,
            updatedAt: 1,
          },
        ],
        today: [],
        yesterday: [],
        week: [],
      },
      ['pinned', 'today', 'yesterday', 'week'],
      { pinned: 'Pinned', today: 'Today', yesterday: 'Yesterday', week: 'This week' }
    )

    expect(rows).toEqual([
      { kind: 'group', id: 'group-pinned', label: 'Pinned' },
      {
        kind: 'conversation',
        id: 'pinned-1',
        conversation: expect.objectContaining({ id: 'pinned-1', title: 'Pinned' }),
      },
    ])
  })

  it('does not render headers for empty groups', () => {
    const rows = flattenConversationGroups(
      { pinned: [], today: [], yesterday: [], week: [] },
      ['pinned', 'today', 'yesterday', 'week'],
      { pinned: 'Pinned', today: 'Today', yesterday: 'Yesterday', week: 'This week' }
    )

    expect(rows).toEqual([])
  })
})
