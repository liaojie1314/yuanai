import { describe, it, expect, beforeEach } from 'vitest'
import { useArtifactStore } from '../artifact.store'

beforeEach(() => {
  useArtifactStore.getState().close()
})

describe('artifact.store', () => {
  it('初始状态：面板关闭且 payload 为 null', () => {
    const s = useArtifactStore.getState()
    expect(s.open).toBe(false)
    expect(s.payload).toBeNull()
  })

  it('openView 设置 view 模式', () => {
    useArtifactStore.getState().openView({ title: '示例', lang: 'html', code: '<p/>' })
    const s = useArtifactStore.getState()
    expect(s.open).toBe(true)
    expect(s.payload?.kind).toBe('code')
    expect(s.payload?.kind === 'code' ? s.payload.mode : undefined).toBe('view')
    expect(s.payload?.title).toBe('示例')
  })

  it('openRun 设置 run 模式', () => {
    useArtifactStore.getState().openRun({ title: 'x', lang: 'js', code: 'a=1' })
    const payload = useArtifactStore.getState().payload
    expect(payload?.kind === 'code' ? payload.mode : undefined).toBe('run')
  })

  it('openFilePreview 记录文件载荷', () => {
    useArtifactStore.getState().openFilePreview({
      fileId: 'file-1',
      title: 'notes.txt',
      mimeType: 'text/plain',
      url: 'https://files.example.com/notes.txt',
    })
    const payload = useArtifactStore.getState().payload
    expect(payload?.kind).toBe('file')
    expect(payload?.kind === 'file' ? payload.fileId : undefined).toBe('file-1')
  })

  it('close 清空 payload', () => {
    useArtifactStore.getState().openView({ title: 'x', lang: 'js', code: 'a=1' })
    useArtifactStore.getState().close()
    const s = useArtifactStore.getState()
    expect(s.open).toBe(false)
    expect(s.payload).toBeNull()
  })
})
