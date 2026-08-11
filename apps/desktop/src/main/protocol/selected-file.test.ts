import { describe, expect, it } from 'vitest'

import { createSelectedFileRegistry, parseSelectedFileUrl } from './selected-file'

describe('selected local file protocol', () => {
  it('returns an opaque, one-time URL without exposing the selected path', () => {
    const registry = createSelectedFileRegistry()
    const [selectedFile] = registry.register(['/tmp/private-project-notes.md'])
    if (!selectedFile) throw new Error('未登记测试文件')

    expect(selectedFile.name).toBe('private-project-notes.md')
    expect(selectedFile.url).toMatch(/^yuanai-file:\/\/selected\//)
    expect(selectedFile.url).not.toContain('/tmp/')

    const token = parseSelectedFileUrl(selectedFile.url)
    if (!token) throw new Error('未解析出测试令牌')
    expect(registry.take(token)).toBe('/tmp/private-project-notes.md')
    expect(registry.take(token)).toBeNull()
  })

  it.each([
    'yuanai-file://selected/not-a-uuid',
    'yuanai-file://selected/550e8400-e29b-41d4-a716-446655440000?path=/tmp/private.txt',
    'yuanai-file://other/550e8400-e29b-41d4-a716-446655440000',
    'file:///tmp/private.txt',
  ])('rejects untrusted local file URL %s', (url) => {
    expect(parseSelectedFileUrl(url)).toBeNull()
  })
})
