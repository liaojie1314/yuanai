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
    expect(s.payload?.mode).toBe('view')
    expect(s.payload?.title).toBe('示例')
  })

  it('openRun 设置 run 模式', () => {
    useArtifactStore.getState().openRun({ title: 'x', lang: 'js', code: 'a=1' })
    expect(useArtifactStore.getState().payload?.mode).toBe('run')
  })

  it('close 清空 payload', () => {
    useArtifactStore.getState().openView({ title: 'x', lang: 'js', code: 'a=1' })
    useArtifactStore.getState().close()
    const s = useArtifactStore.getState()
    expect(s.open).toBe(false)
    expect(s.payload).toBeNull()
  })
})
