import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MediaGenerationTask } from '@yuanai/types'

import { MediaTaskCard } from '../MediaTaskCard'

const openMediaPreview = vi.fn()

vi.mock('@yuanai/core/hooks', () => ({
  useCancelMediaTask: () => ({ isPending: false, mutate: vi.fn() }),
  useCreateMediaTask: () => ({ isPending: false, mutate: vi.fn() }),
}))
vi.mock('@yuanai/core/stores', () => ({
  useArtifactStore: (selector: (state: { openMediaPreview: typeof openMediaPreview }) => unknown) =>
    selector({ openMediaPreview }),
}))

const task: MediaGenerationTask = {
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
  ...task,
  id: 'music-task-12345678',
  type: 'music',
  model: 'elevenlabs-music-v1',
  prompt: '舒缓钢琴',
  options: { durationSeconds: 30 },
  resultUrl: 'http://localhost:9000/generated/music.mp3',
  resultPosterUrl: null,
  resultMimeType: 'audio/mpeg',
  resultWidth: null,
  resultHeight: null,
  resultDurationSeconds: 30,
}

const activeTask: MediaGenerationTask = { ...task, status: 'running', progress: 42 }
const failedTask: MediaGenerationTask = {
  ...task,
  status: 'failed',
  resultUrl: null,
  errorMessage: '供应商暂时不可用',
}

describe('MediaTaskCard', () => {
  it('renders a poster instead of a video element in the message list', () => {
    const { container } = render(<MediaTaskCard task={task} />)

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', task.resultPosterUrl)
    expect(container.querySelector('.ch-media-task__visual')).not.toBeNull()
    expect(container.querySelector('.ch-media-task__play')).not.toBeNull()
  })

  it('renders music as a controlled audio element without autoplay', () => {
    const { container } = render(<MediaTaskCard task={musicTask} />)

    const audio = container.querySelector('audio')
    expect(audio).toHaveAttribute('src', musicTask.resultUrl)
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).not.toHaveAttribute('autoplay')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('a[download]')).toHaveAttribute('download')
  })

  it('keeps cancel controls for running tasks', () => {
    const { getByRole } = render(<MediaTaskCard task={activeTask} />)

    expect(getByRole('button', { name: /停止/ })).toBeInTheDocument()
    expect(getByRole('progressbar', { name: /生成进度/ })).toBeInTheDocument()
  })

  it('keeps the error and retry controls for failed tasks', () => {
    const { getByRole, getByText } = render(<MediaTaskCard task={failedTask} />)

    expect(getByText('供应商暂时不可用')).toBeInTheDocument()
    expect(getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })
})
