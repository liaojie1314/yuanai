import { describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react-native', () => ({
  FileArchive: 'FileArchive',
  FileAudio: 'FileAudio',
  FileImage: 'FileImage',
  FileSpreadsheet: 'FileSpreadsheet',
  FileText: 'FileText',
  FileType2: 'FileType2',
  FileVideo: 'FileVideo',
}))

import { getAttachmentMeta, isImageAttachment } from './attachmentMeta'

describe('attachmentMeta', () => {
  it('uses image filename extensions when historic uploads have a generic MIME type', () => {
    expect(isImageAttachment('application/octet-stream', 'meeting-photo.JPEG')).toBe(true)
    expect(getAttachmentMeta('application/octet-stream', 'meeting-photo.JPEG').kind).toBe('image')
  })

  it.each([
    ['report.pdf', 'application/octet-stream', 'pdf'],
    ['budget.xlsx', 'application/octet-stream', 'sheet'],
    ['notes.docx', 'application/octet-stream', 'document'],
    ['payload.json', 'application/octet-stream', 'text'],
    ['archive.zip', 'application/zip', 'archive'],
  ] as const)('classifies %s as a %s card', (filename, mimeType, expectedKind) => {
    expect(getAttachmentMeta(mimeType, filename).kind).toBe(expectedKind)
  })
})
