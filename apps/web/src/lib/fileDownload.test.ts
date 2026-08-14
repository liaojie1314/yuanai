import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@yuanai/core'
import { downloadSourceFile } from './fileDownload'

vi.mock('@yuanai/core', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

const mockedGet = vi.mocked(apiClient.get)

describe('downloadSourceFile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(),
      writable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
      writable: true,
    })
    mockedGet.mockResolvedValue({ data: new Blob(['file content'], { type: 'text/plain' }) })
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:source-file')
    vi.mocked(URL.revokeObjectURL).mockImplementation(() => undefined)
  })

  it('通过带 attachment 响应的鉴权接口下载，并延后回收 Blob URL', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const appendChild = vi.spyOn(document.body, 'appendChild')

    await downloadSourceFile('file id', 'README.md')

    expect(mockedGet).toHaveBeenCalledWith('/files/file%20id/download', { responseType: 'blob' })
    const anchor = appendChild.mock.calls[0]?.[0]
    expect(anchor).toBeInstanceOf(HTMLAnchorElement)
    expect(anchor).toMatchObject({ download: 'README.md', href: 'blob:source-file' })
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source-file')
  })
})
