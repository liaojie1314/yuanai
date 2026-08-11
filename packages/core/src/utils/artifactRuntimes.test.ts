import { describe, expect, it } from 'vitest'

import { ARTIFACT_MSG_SOURCE, buildJsDoc } from './artifactRuntimes.js'

describe('buildJsDoc', () => {
  it('executes escaped inline source without requiring eval', () => {
    const doc = buildJsDoc('console.log("完成"); const html = "</script>";')

    expect(doc).toContain(ARTIFACT_MSG_SOURCE)
    expect(doc).toContain('console.log("完成")')
    expect(doc).toContain('"<\\/script>"')
    expect(doc).not.toContain('(0,eval)')
  })
})
