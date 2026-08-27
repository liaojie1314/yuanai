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
  model: 'musicgen-small-local',
  prompt: '舒缓钢琴',
  options: { durationSeconds: 30 },
  resultUrl: 'http://localhost:9000/generated/music.mp3',
  resultPosterUrl: null,
  resultMimeType: 'audio/mpeg',
  resultWidth: null,
  resultHeight: null,
  resultDurationSeconds: 30,
}

const lyricMusicTask: MediaGenerationTask = {
  ...musicTask,
  id: 'lyric-music-task-12345678',
  model: 'ace-step-v15-local',
  options: { durationSeconds: 30, lyrics: '窗外微光落在清晨' },
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

  it('renders music in a compact player without autoplay', () => {
    const { container } = render(<MediaTaskCard task={musicTask} />)

    const audio = container.querySelector('audio')
    expect(audio).toHaveAttribute('src', musicTask.resultUrl)
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).not.toHaveAttribute('autoplay')
    expect(container.querySelector('.ch-media-task__music')).not.toBeNull()
    expect(container.querySelector('.ch-media-task__music-meta')).toHaveTextContent('MusicGen')
    expect(container.querySelector('input[type="range"]')).toHaveAttribute(
      'aria-label',
      '音乐播放进度'
    )
    expect(container.querySelector('.ch-media-task__music-download')).toHaveAttribute('download')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('.ch-media-task__actions a[download]')).toHaveClass(
      'ch-media-task__download-hidden'
    )
  })

  it('identifies a lyric song as an ACE-Step result', () => {
    const { getByText } = render(<MediaTaskCard task={lyricMusicTask} />)

    expect(getByText('ACE-Step')).toBeInTheDocument()
  })

  it('keeps cancel controls for running tasks', () => {
    const { getByRole } = render(<MediaTaskCard task={activeTask} />)

    expect(getByRole('button', { name: /停止/ })).toBeInTheDocument()
    expect(getByRole('progressbar', { name: /生成进度/ })).toBeInTheDocument()
  })

  it('shows an indeterminate progress bar while a task has no provider percentage', () => {
    const activeMusicTask: MediaGenerationTask = {
      ...musicTask,
      status: 'running',
      progress: 0,
      resultUrl: null,
      resultMimeType: null,
    }
    const { getByRole } = render(<MediaTaskCard task={activeMusicTask} />)

    expect(getByRole('progressbar')).toHaveClass('ch-media-task__progress--indeterminate')
    expect(getByRole('progressbar')).toHaveAttribute('aria-valuetext', '正在生成')
  })

  it('keeps the error and retry controls for failed tasks', () => {
    const { getByRole, getByText } = render(<MediaTaskCard task={failedTask} />)

    expect(getByText('供应商暂时不可用')).toBeInTheDocument()
    expect(getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })
})
