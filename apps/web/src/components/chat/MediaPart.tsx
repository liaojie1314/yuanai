'use client'

import { useState, type JSX } from 'react'
import { Image as ImageIcon, Music, Video } from 'lucide-react'
import type { MediaPart as MediaPartType } from '@yuanai/types'

export interface MediaPartProps {
  /** 多模态资源 part */
  part: MediaPartType
}

/**
 * 多模态资源渲染组件（图片 / 音频 / 视频）。
 *
 * 加载中会显示骨架屏；加载失败时降级到占位图 + 描述文案。
 * 供后端后续接入 AI 生成图片/音频/视频时直接使用。
 */
export function MediaPart({ part }: MediaPartProps): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (part.mediaType === 'image') {
    return (
      <figure className="ch-media ch-media-image">
        {!loaded && !error && <div className="ch-media-skel" aria-hidden="true" />}
        {error ? (
          <div className="ch-media-err">
            <ImageIcon size={18} />
            <span>图片加载失败</span>
          </div>
        ) : (
          <img
            src={part.url}
            alt={part.caption ?? '图片'}
            width={part.width}
            height={part.height}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
        {part.caption && <figcaption className="ch-media-cap">{part.caption}</figcaption>}
      </figure>
    )
  }

  if (part.mediaType === 'audio') {
    return (
      <div className="ch-media ch-media-audio">
        <div className="ch-media-hd">
          <Music size={14} />
          <span>{part.caption ?? '音频'}</span>
          {part.durationSec !== undefined && (
            <span className="ch-media-dur">{Math.round(part.durationSec)} 秒</span>
          )}
        </div>
        <audio controls src={part.url} onError={() => setError(true)} preload="metadata">
          你的浏览器不支持音频播放
        </audio>
        {error && <div className="ch-media-err-hint">音频加载失败</div>}
      </div>
    )
  }

  return (
    <figure className="ch-media ch-media-video">
      <div className="ch-media-hd">
        <Video size={14} />
        <span>{part.caption ?? '视频'}</span>
        {part.durationSec !== undefined && (
          <span className="ch-media-dur">{Math.round(part.durationSec)} 秒</span>
        )}
      </div>
      <video
        controls
        src={part.url}
        width={part.width}
        height={part.height}
        preload="metadata"
        onError={() => setError(true)}
      >
        你的浏览器不支持视频播放
      </video>
      {part.caption && <figcaption className="ch-media-cap">{part.caption}</figcaption>}
      {error && <div className="ch-media-err-hint">视频加载失败</div>}
    </figure>
  )
}
