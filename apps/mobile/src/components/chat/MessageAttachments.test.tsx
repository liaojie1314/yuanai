import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestInstance } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageFile } from '@yuanai/types'

const preview = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('react-native', () => ({
  Image: 'Image',
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}))

vi.mock('lucide-react-native', () => ({
  FileArchive: 'FileArchive',
  FileAudio: 'FileAudio',
  FileImage: 'FileImage',
  FileSpreadsheet: 'FileSpreadsheet',
  FileText: 'FileText',
  FileType2: 'FileType2',
  FileVideo: 'FileVideo',
  Maximize2: 'Maximize2',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }): string => values?.name ?? key,
  }),
}))

vi.mock('@yuanai/core', () => ({ getApiBaseUrl: () => 'http://api.example.test/api/v1' }))
vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: (selector: (state: { accessToken: string }) => unknown) =>
    selector({ accessToken: 'test-access-token' }),
}))
vi.mock('@/components/ui/ImagePreview', () => ({ useImagePreview: () => preview }))
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    bg: { elevated: '#ffffff' },
    border: { default: '#e5e7eb' },
    text: { muted: '#6b7280', primary: '#111827' },
  }),
}))

import { MessageAttachments } from './MessageAttachments'

const screenshot: MessageFile = {
  id: 'file-image',
  filename: 'desktop-menu.jpg',
  mimeType: 'application/octet-stream',
  sizeBytes: 9_440,
  url: 'https://example.test/desktop-menu.jpg',
}

const worksheet: MessageFile = {
  id: 'file-sheet',
  filename: 'budget.xlsx',
  mimeType: 'application/octet-stream',
  sizeBytes: 1_024,
  url: 'https://example.test/budget.xlsx',
}

function press(root: ReactTestInstance, accessibilityLabel: string): void {
  const target = root.findByProps({ accessibilityLabel })
  const handler = target.props['onPress']
  if (typeof handler !== 'function') throw new Error(`No press handler for ${accessibilityLabel}`)
  act(() => handler())
}

describe('MessageAttachments', () => {
  beforeEach(() => {
    preview.open.mockReset()
  })

  it('renders a thumbnail and opens a gallery even when the stored MIME is generic', () => {
    const renderer = create(createElement(MessageAttachments, { files: [screenshot, worksheet] }))

    expect(renderer.root.findAllByType('Image' as never)).toHaveLength(1)
    expect(renderer.root.findByType('Image' as never).props['source']).toEqual({
      uri: 'http://api.example.test/api/v1/files/file-image/download',
      headers: { Authorization: 'Bearer test-access-token' },
    })

    press(renderer.root, `预览图片 ${screenshot.filename}`)

    expect(preview.open).toHaveBeenCalledWith([screenshot], screenshot.id)
  })

  it('uses the matching Lucide document icon instead of an emoji glyph', () => {
    const renderer = create(createElement(MessageAttachments, { files: [worksheet] }))

    expect(renderer.root.findAllByType('FileSpreadsheet' as never)).toHaveLength(1)
  })
})
