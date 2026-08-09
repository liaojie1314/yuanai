import { describe, expect, it } from 'vitest'

import { bootstrapDesktop } from './bootstrap'

describe('bootstrapDesktop', () => {
  it('registers the desktop adapter and API URL before importing stores or mounting', async () => {
    const events: string[] = []
    await bootstrapDesktop({
      api: {
        runtime: {
          getConfig: async () => ({
            apiBaseUrl: 'https://api.example.com/api/v1',
            webBaseUrl: 'https://yuanai.example.com',
            assetOrigins: [],
          }),
        },
      },
      adapter: {} as never,
      setAdapter: () => events.push('adapter'),
      setApiUrl: () => events.push('api'),
      importStores: async () => {
        events.push('stores')
      },
      mount: () => events.push('mount'),
    })

    expect(events).toEqual(['adapter', 'api', 'stores', 'mount'])
  })
})
