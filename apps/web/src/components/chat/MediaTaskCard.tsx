'use client'

import {
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Play,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react'
import type { JSX } from 'react'

import { useCancelMediaTask, useCreateMediaTask } from '@yuanai/core/hooks'
import { useArtifactStore } from '@yuanai/core/stores'
import type { MediaGenerationTask } from '@yuanai/types'

/** 生成任务的结果类型到可展示标题的映射。 */
function taskLabel(task: MediaGenerationTask): string {
  return task.type === 'image' ? '图片生成' : task.type === 'music' ? '音乐生成' : '视频生成'
}

/** 会话内图片或视频任务的可恢复卡片。 */
export function MediaTaskCard({ task }: { task: MediaGenerationTask }): JSX.Element {
  const openMediaPreview = useArtifactStore((state) => state.openMediaPreview)
  const cancel = useCancelMediaTask()
  const retry = useCreateMediaTask()
  const active = task.status === 'queued' || task.status === 'running'
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
          className="ch-media-task__progress"
          aria-label={`生成进度 ${task.progress}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={task.progress}
          role="progressbar"
        >
          <span style={{ width: `${Math.max(4, task.progress)}%` }} />
        </div>
      ) : null}

      {task.status === 'succeeded' && task.resultUrl && task.type === 'music' ? (
        <audio controls preload="metadata" src={task.resultUrl} aria-label={`${title}音频`} />
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
          <a href={task.resultUrl} download={outputName}>
            <Download size={13} /> 下载
          </a>
        ) : null}
      </div>
    </section>
  )
}
