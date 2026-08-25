import { fireEvent, render, screen } from '@testing-library/react'
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

const musicTask: MediaGenerationTask = {
  ...mediaTask,
  id: 'music-task-12345678',
  type: 'music',
  model: 'elevenlabs-music-v1',
  prompt: '生成一段轻快的器乐音乐',
  options: { durationSeconds: 30 },
  resultUrl: 'http://localhost:9000/generated/music.mp3',
  resultPosterUrl: null,
  resultMimeType: 'audio/mpeg',
  resultDurationSeconds: 30,
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

const searchedMessage: Message = {
  id: 'message-search-1',
  role: Role.Assistant,
  content: '这是带来源的回答',
  files: [],
  toolCalls: [
    {
      id: 'tool-search-1',
      name: 'search_web',
      arguments: '{"query":"元AI"}',
      status: 'done',
      result: '已检索 1 条网页来源',
      sources: [
        {
          title: '元AI 搜索来源',
          url: 'https://example.com/research',
          snippet: '安全的来源摘要',
          provider: 'searxng',
        },
      ],
    },
  ],
  createdAt: '2026-08-16T00:00:00Z',
}

describe('ChatMessage media task', () => {
  it('uses a poster image, exposes a download action, and keeps video Artifact preview', () => {
    const onOpenArtifact = vi.fn()
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
        onOpenArtifact={onOpenArtifact}
        onFeedback={vi.fn()}
      />
    )

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', mediaTask.resultPosterUrl)
    expect(screen.getByRole('link', { name: '下载视频生成' })).toHaveAttribute(
      'href',
      mediaTask.resultUrl
    )

    fireEvent.click(screen.getByRole('button', { name: '预览视频生成' }))
    expect(onOpenArtifact).toHaveBeenCalledWith({
      kind: 'file-preview',
      title: '视频生成-task-123',
      sourceUrl: mediaTask.resultUrl,
      mimeType: mediaTask.resultMimeType,
    })
  })

  it('renders non-autoplaying native audio and a media URL download for music', () => {
    const { container } = render(
      <ChatMessage
        user={null}
        message={{ ...message, mediaTask: musicTask }}
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

    const audio = container.querySelector('audio')
    expect(audio).not.toBeNull()
    if (!audio) throw new Error('Expected music audio element')
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).not.toHaveAttribute('autoplay')
    expect(audio).toHaveAttribute('src', musicTask.resultUrl)
    expect(screen.getByRole('link', { name: '下载音乐生成' })).toHaveAttribute(
      'href',
      musicTask.resultUrl
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('button', { name: '预览音乐生成' })).not.toBeInTheDocument()
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

  it('renders persisted HTTPS search sources inside the tool details', () => {
    const { container } = render(
      <ChatMessage
        user={null}
        message={searchedMessage}
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

    const thinkingToggle = container.querySelector<HTMLButtonElement>(
      '.desktop-chat__thinking > button'
    )
    expect(thinkingToggle).not.toBeNull()
    fireEvent.click(thinkingToggle as HTMLButtonElement)
    expect(screen.getByRole('button', { name: '元AI 搜索来源' })).toBeInTheDocument()
    expect(screen.queryByText('chat.thinkingPreparing')).not.toBeInTheDocument()
  })

  it('notifies the virtual list when the thinking block is toggled', () => {
    const onThinkingOpenChange = vi.fn()
    const { container } = render(
      <ChatMessage
        user={null}
        message={{
          ...searchedMessage,
          thinkingContent: '先检索可靠来源，再组织回答。',
        }}
        isStreaming={false}
        canRegenerate={false}
        timeFmt="24h"
        dateFmt="ymd"
        onEditMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onOpenArtifact={vi.fn()}
        onFeedback={vi.fn()}
        thinkingOpen={false}
        onThinkingOpenChange={onThinkingOpenChange}
      />
    )

    const thinkingToggle = container.querySelector<HTMLButtonElement>(
      '.desktop-chat__thinking > button'
    )
    expect(thinkingToggle).not.toBeNull()
    fireEvent.click(thinkingToggle as HTMLButtonElement)
    expect(onThinkingOpenChange).toHaveBeenCalledWith(true)
  })

  it('notifies the virtual list when a search detail is toggled', () => {
    const onToolCallOpenChange = vi.fn()
    const { container } = render(
      <ChatMessage
        user={null}
        message={searchedMessage}
        isStreaming={false}
        canRegenerate={false}
        timeFmt="24h"
        dateFmt="ymd"
        onEditMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onOpenArtifact={vi.fn()}
        onFeedback={vi.fn()}
        thinkingOpen
        toolCallOpenById={{ 'tool-search-1': false }}
        onToolCallOpenChange={onToolCallOpenChange}
      />
    )

    const detailSummary = container.querySelector<HTMLElement>('.desktop-chat__tool-call > summary')
    expect(detailSummary).not.toBeNull()
    fireEvent.click(detailSummary as HTMLElement)
    expect(onToolCallOpenChange).toHaveBeenCalledWith('tool-search-1', true)
  })
})
