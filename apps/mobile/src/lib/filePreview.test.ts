import { describe, expect, it, vi } from 'vitest'

vi.mock('@yuanai/core', () => ({ getApiBaseUrl: () => 'http://192.168.1.2:8000/api/v1' }))

import { getMobileFileDownloadUrl, getMobileImageSource } from './filePreview'

describe('mobile file previews', () => {
  it('uses the API download endpoint rather than the device-inaccessible object-store host', () => {
    expect(getMobileFileDownloadUrl('file/with space')).toBe(
      'http://192.168.1.2:8000/api/v1/files/file%2Fwith%20space/download'
    )
  })

  it('passes the access token as a request header rather than a URL parameter', () => {
    expect(getMobileImageSource({ id: 'file-1' }, 'jwt-value')).toEqual({
      uri: 'http://192.168.1.2:8000/api/v1/files/file-1/download',
      headers: { Authorization: 'Bearer jwt-value' },
    })
  })
})
