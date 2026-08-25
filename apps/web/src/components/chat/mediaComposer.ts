import { MediaMusicDurationSeconds } from '@yuanai/types'
import type { CreateMediaGenerationTaskInput, MediaGenerationOptions } from '@yuanai/types'

/** Web composer 支持的媒体模式。 */
export type MediaComposerMode = 'image' | 'video' | 'music'

/** 固定的 ElevenLabs Music 任务时长。 */
export const MUSIC_DURATION_SECONDS = MediaMusicDurationSeconds

/** 根据 composer 模式构造经过限制的媒体任务输入。 */
export function buildMediaTaskInput(
  conversationId: string,
  mode: MediaComposerMode,
  prompt: string,
  options: MediaGenerationOptions,
  sourceFileIds: string[]
): CreateMediaGenerationTaskInput {
  return {
    conversationId,
    type: mode,
    prompt,
    options: mode === 'music' ? { durationSeconds: MUSIC_DURATION_SECONDS } : options,
    sourceFileIds: mode === 'music' ? [] : sourceFileIds,
  }
}

/** 音乐模式不能附带图片或文件，确保上传控件状态与任务契约一致。 */
export function mediaComposerAllowsAttachments(mode: MediaComposerMode): boolean {
  return mode !== 'music'
}
