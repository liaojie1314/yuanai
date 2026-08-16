import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Role } from '@yuanai/types'
import type { MediaGenerationTask, Message } from '@yuanai/types'

import { ChatMessage } from './MessageContent'

vi.mock('@yuanai/core', () => ({ getFilePreview: vi.fn() }))
vi.mock('@yuanai/core/hooks', () => ({
  useCancelMediaTask: () => ({ isPending: false, mutate: vi.fn() }),
  useCreateMediaTask: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const mediaTask: MediaGenerationTask = {
  id: 'task-12345678',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  sourceMessageId: 'source-1',
  type: 'video',
  model: 'agnes-video-v2.0',
  prompt: '生成一个日落海滩视频',
  options: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5 },
  sourceFileIds: [],
  status: 'succeeded',
  progress: 100,
  resultUrl: 'http://localhost:9000/generated/video.mp4',
  resultPosterUrl: 'http://localhost:9000/generated/video.poster.jpg',
  resultMimeType: 'video/mp4',
  resultWidth: 1280,
  resultHeight: 720,
  resultDurationSeconds: 5,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
}

const message: Message = {
  id: 'message-1',
  role: Role.Assistant,
  content: '视频生成完成',
  model: 'agnes-video-v2.0',
  files: [],
  mediaTask,
  createdAt: '2026-08-16T00:00:00Z',
}

const imageMessage: Message = {
  id: 'message-image-1',
  role: Role.User,
  content: '请看这个图片',
  files: [
    {
      id: 'file-image-1',
      filename: 'sunset.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      url: 'http://localhost:9000/files/sunset.png',
    },
  ],
  createdAt: '2026-08-16T00:00:00Z',
}

describe('ChatMessage media task', () => {
  it('uses a poster image in the timeline and exposes a download action', () => {
    const { container } = render(
      <ChatMessage
        user={null}
        message={message}
        isStreaming={false}
        canRegenerate={false}
        timeFmt="24h"
        dateFmt="ymd"
        onEditMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onOpenArtifact={vi.fn()}
        onFeedback={vi.fn()}
      />
    )

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', mediaTask.resultPosterUrl)
    expect(screen.getByRole('link', { name: '下载视频生成' })).toHaveAttribute(
      'href',
      mediaTask.resultUrl
    )
  })

  it('exposes a download action for an uploaded image attachment', () => {
    render(
      <ChatMessage
        user={null}
        message={imageMessage}
        isStreaming={false}
        canRegenerate={false}
        timeFmt="24h"
        dateFmt="ymd"
        onEditMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onOpenArtifact={vi.fn()}
        onFeedback={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '下载 sunset.png' })).toHaveAttribute(
      'href',
      imageMessage.files[0]?.url
    )
  })
})
