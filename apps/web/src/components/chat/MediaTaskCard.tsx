'use client'

import {
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Pause,
  Play,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'

import { useCancelMediaTask, useCreateMediaTask } from '@yuanai/core/hooks'
import { useArtifactStore } from '@yuanai/core/stores'
import type { MediaGenerationTask } from '@yuanai/types'

/** 生成任务的结果类型到可展示标题的映射。 */
function taskLabel(task: MediaGenerationTask): string {
  return task.type === 'image' ? '图片生成' : task.type === 'music' ? '音乐生成' : '视频生成'
}

/** 将播放器秒数显示为紧凑的分:秒格式。 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const totalSeconds = Math.floor(seconds)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

/** 音乐结果播放器，使用原生 audio 播放但提供稳定的跨浏览器外观。 */
function MusicPlayer({
  task,
  outputName,
}: {
  task: MediaGenerationTask
  outputName: string
}): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(task.resultDurationSeconds ?? 0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const syncTime = (): void => setCurrentTime(audio.currentTime)
    const syncDuration = (): void => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const syncPlaying = (): void => setPlaying(!audio.paused)
    const resetPlaying = (): void => {
      setPlaying(false)
      setCurrentTime(0)
    }
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('play', syncPlaying)
    audio.addEventListener('pause', syncPlaying)
    audio.addEventListener('ended', resetPlaying)
    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('play', syncPlaying)
      audio.removeEventListener('pause', syncPlaying)
      audio.removeEventListener('ended', resetPlaying)
    }
  }, [task.resultUrl])

  const togglePlayback = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const seek = (event: ChangeEvent<HTMLInputElement>): void => {
    const audio = audioRef.current
    const nextTime = Number(event.target.value)
    if (!audio || !Number.isFinite(nextTime)) return
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div className="ch-media-task__music">
      <audio ref={audioRef} preload="metadata" src={task.resultUrl ?? undefined} />
      <button
        className="ch-media-task__music-play"
        type="button"
        aria-label={playing ? '暂停音乐' : '播放音乐'}
        onClick={togglePlayback}
      >
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <div className="ch-media-task__music-main">
        <div className="ch-media-task__music-meta">
          <span>{task.options.lyrics?.trim() ? 'ACE-Step' : 'MusicGen'}</span>
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        <div className="ch-media-task__music-seek-wrap">
          <span className="ch-media-task__music-seek-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
          <input
            className="ch-media-task__music-seek"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(currentTime, duration || 1)}
            aria-label="音乐播放进度"
            onChange={seek}
          />
        </div>
      </div>
      <a
        className="ch-media-task__music-download"
        href={task.resultUrl ?? undefined}
        download={outputName}
        aria-label="下载音乐"
      >
        <Download size={16} />
      </a>
    </div>
  )
}

/** 会话内图片或视频任务的可恢复卡片。 */
export function MediaTaskCard({ task }: { task: MediaGenerationTask }): JSX.Element {
  const openMediaPreview = useArtifactStore((state) => state.openMediaPreview)
  const cancel = useCancelMediaTask()
  const retry = useCreateMediaTask()
  const active = task.status === 'queued' || task.status === 'running'
  const indeterminate = active && task.progress <= 0
  const title = taskLabel(task)
  const outputName = `${title}-${task.id.slice(0, 8)}${task.type === 'image' ? '.png' : task.type === 'music' ? '.mp3' : '.mp4'}`
  const requestedRatio = task.type === 'image' ? task.options.ratio : task.options.aspectRatio
  const resultStyle = {
    aspectRatio: requestedRatio
      ? requestedRatio.replace(':', ' / ')
      : task.type === 'image'
        ? '1 / 1'
        : '16 / 9',
  }

  const openPreview = (): void => {
    if (!task.resultUrl || !task.resultMimeType) return
    openMediaPreview({
      title: outputName,
      mimeType: task.resultMimeType,
      url: task.resultUrl,
    })
  }

  return (
    <section className="ch-media-task" aria-label={`${title}任务`}>
      <div className="ch-media-task__head">
        <span className="ch-media-task__icon" aria-hidden="true">
          {task.type === 'image' ? (
            <ImageIcon size={16} />
          ) : task.type === 'music' ? (
            <Music size={16} />
          ) : (
            <Play size={16} />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <p>{task.prompt}</p>
        </div>
        {active ? <LoaderCircle className="ch-spin" size={16} aria-label="生成中" /> : null}
      </div>

      {active ? (
        <div
          className={[
            'ch-media-task__progress',
            indeterminate ? 'ch-media-task__progress--indeterminate' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={`生成进度 ${task.progress}%`}
          aria-valuetext={indeterminate ? '正在生成' : `${task.progress}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={task.progress}
          role="progressbar"
        >
          <span style={indeterminate ? undefined : { width: `${Math.max(4, task.progress)}%` }} />
        </div>
      ) : null}

      {task.status === 'succeeded' && task.resultUrl && task.type === 'music' ? (
        <MusicPlayer task={task} outputName={outputName} />
      ) : null}

      {task.status === 'succeeded' && task.resultUrl && task.type !== 'music' ? (
        <button
          className={`ch-media-task__result${task.type === 'video' ? 'ch-media-task__result--video' : ''}`}
          type="button"
          aria-label={`打开${title}预览`}
          style={resultStyle}
          onClick={openPreview}
        >
          <span className="ch-media-task__visual">
            {task.type === 'image' ? (
              <img src={task.resultUrl} alt={task.prompt} />
            ) : task.resultPosterUrl ? (
              <img src={task.resultPosterUrl} alt="" />
            ) : (
              <span className="ch-media-task__video-fallback" aria-hidden="true" />
            )}
            {task.type === 'video' ? (
              <span className="ch-media-task__play" aria-hidden="true">
                <Play size={20} fill="currentColor" />
              </span>
            ) : null}
          </span>
        </button>
      ) : null}

      {task.status === 'failed' ? (
        <p className="ch-media-task__error">
          <XCircle size={15} aria-hidden="true" /> {task.errorMessage ?? '生成失败，请重试'}
        </p>
      ) : null}

      <div className="ch-media-task__actions">
        {active ? (
          <button type="button" onClick={() => cancel.mutate(task.id)} disabled={cancel.isPending}>
            <Square size={13} fill="currentColor" /> 停止
          </button>
        ) : null}
        {task.status === 'failed' ? (
          <button
            type="button"
            onClick={() =>
              retry.mutate({
                conversationId: task.conversationId,
                type: task.type,
                prompt: task.prompt,
                options: task.options,
                sourceFileIds: task.sourceFileIds,
              })
            }
            disabled={retry.isPending}
          >
            <RotateCcw size={13} /> 重试
          </button>
        ) : null}
        {task.status === 'succeeded' && task.resultUrl ? (
          <a
            className={task.type === 'music' ? 'ch-media-task__download-hidden' : undefined}
            href={task.resultUrl}
            download={outputName}
          >
            <Download size={13} /> 下载
          </a>
        ) : null}
      </div>
    </section>
  )
}
