import { createElement } from 'react'
import * as React from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import type { MediaGenerationTask } from '@yuanai/types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Linking: { openURL: vi.fn() },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'ios' },
}))

vi.mock('expo-av', () => ({
  Audio: { Sound: vi.fn() },
  ResizeMode: { CONTAIN: 'contain' },
  Video: 'Video',
}))

vi.mock('lucide-react-native', () => ({
  Download: 'Download',
  Globe: 'Globe',
  Image: 'ImageIcon',
  Mic: 'Mic',
  Music: 'Music',
  Pause: 'Pause',
  Paperclip: 'Paperclip',
  Play: 'Play',
  RotateCcw: 'RotateCcw',
  Send: 'Send',
  Sparkles: 'Sparkles',
  Square: 'Square',
  Video: 'Video',
  X: 'X',
  XCircle: 'XCircle',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@yuanai/core/stores', () => ({
  usePrefsStore: (
    selector: (state: { showThinking: boolean; setShowThinking: () => void }) => unknown
  ) => selector({ showThinking: false, setShowThinking: vi.fn() }),
}))

vi.mock('@/components/chat/AttachmentTray', () => ({ AttachmentTray: 'AttachmentTray' }))
vi.mock('@/components/ui/Dialog', () => ({
  useDialog: () => ({ alert: vi.fn(async () => undefined) }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('@/hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    status: 'idle',
    isAvailable: false,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: () => ({
    attachments: [],
    openAttachSheet: vi.fn(async () => undefined),
    remove: vi.fn(),
    clear: vi.fn(),
    getFileIds: () => [],
    isUploading: false,
  }),
}))
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    bg: { base: '#fff', elevated: '#f3f4f6', surface: '#fff' },
    border: { default: '#e5e7eb' },
    brand: { selected: '#dbeafe', selectedFg: '#1d4ed8', solid: '#2563eb' },
    text: { inverse: '#fff', muted: '#6b7280', primary: '#111827', secondary: '#374151' },
    density: { inputMinH: 48, inputPy: 12 },
    typography: { body: 15, bodyLineHeight: 22 },
  }),
}))

vi.stubGlobal('React', React)

const mediaActions = vi.hoisted(() => ({ cancel: vi.fn(), retry: vi.fn() }))

vi.mock('@yuanai/core', () => ({
  useCancelMediaTask: () => ({ isPending: false, mutate: mediaActions.cancel }),
  useCreateMediaTask: () => ({ isPending: false, mutate: mediaActions.retry }),
}))

import { ChatInput } from './ChatInput'
import { MediaTaskCard } from './MediaTaskCard'

function findPressable(renderer: ReturnType<typeof create>, label: string): ReactTestInstance {
  return renderer.root.findByProps({ accessibilityLabel: label })
}

const musicTask: MediaGenerationTask = {
  id: 'music-task-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  sourceMessageId: 'source-1',
  type: 'music',
  model: 'elevenlabs-music-v1',
  prompt: '轻快的器乐音乐',
  options: { durationSeconds: 30 },
  sourceFileIds: [],
  status: 'succeeded',
  progress: 100,
  resultUrl: 'https://example.test/generated/music.mp3',
  resultPosterUrl: null,
  resultMimeType: 'audio/mpeg',
  resultWidth: null,
  resultHeight: null,
  resultDurationSeconds: 30,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-25T00:00:00Z',
  updatedAt: '2026-08-25T00:00:00Z',
}

const imageTask: MediaGenerationTask = {
  ...musicTask,
  id: 'image-task-1',
  type: 'image',
  model: 'agnes-image-2.1-flash',
  prompt: '一张日落海滩图片',
  options: { size: '1K', ratio: '1:1' },
  resultUrl: 'https://example.test/generated/image.png',
  resultMimeType: 'image/png',
  resultPosterUrl: null,
  resultDurationSeconds: null,
}

describe('Mobile music generation', () => {
  it('submits the fixed music duration and disables attachments', async () => {
    const onCreateMediaTask = vi.fn(async () => true)
    const renderer = create(
      createElement(ChatInput, {
        mediaGenerationEnabled: true,
        onSend: vi.fn(),
        onCreateMediaTask,
      })
    )

    act(() => findPressable(renderer, '音乐生成').props['onPress']())
    expect(findPressable(renderer, '音乐模式不支持附件').props['accessibilityState']).toMatchObject(
      {
        disabled: true,
      }
    )

    const input = renderer.root.findByType('TextInput' as never)
    act(() => input.props['onChangeText']('生成轻快的器乐音乐'))
    await act(async () => findPressable(renderer, 'chat.send').props['onPress']())

    expect(onCreateMediaTask).toHaveBeenCalledWith({
      content: '生成轻快的器乐音乐',
      type: 'music',
      options: { durationSeconds: 30 },
    })
  })

  it('loads music without autoplay and unloads the sound on unmount', async () => {
    const loadAsync = vi.fn(async () => undefined)
    const playAsync = vi.fn(async () => undefined)
    const pauseAsync = vi.fn(async () => undefined)
    const unloadAsync = vi.fn(async () => undefined)
    const sound = {
      loadAsync,
      playAsync,
      pauseAsync,
      unloadAsync,
      setOnPlaybackStatusUpdate: vi.fn(),
    }
    const soundConstructor = vi.mocked((await import('expo-av')).Audio.Sound)
    soundConstructor.createAsync = vi.fn(
      async (..._args: Parameters<typeof soundConstructor.createAsync>) =>
        ({
          sound,
          status: {
            isLoaded: true,
            isPlaying: false,
            positionMillis: 0,
            durationMillis: 30_000,
          },
        }) as never
    )

    const renderer = create(createElement(MediaTaskCard, { task: musicTask }))
    await act(async () => undefined)
    expect(soundConstructor.createAsync).toHaveBeenCalledWith(
      { uri: musicTask.resultUrl },
      { shouldPlay: false, progressUpdateIntervalMillis: 250 },
      expect.any(Function)
    )
    const playButton = findPressable(renderer, '播放音乐')
    await act(async () => playButton.props['onPress']())
    expect(playAsync).toHaveBeenCalledOnce()
    await act(async () => findPressable(renderer, '暂停音乐').props['onPress']())
    expect(pauseAsync).toHaveBeenCalledOnce()
    await act(async () => renderer.unmount())
    expect(unloadAsync).toHaveBeenCalledOnce()
  })

  it('unloads the previous sound when the music source changes', async () => {
    const firstSound = { unloadAsync: vi.fn(async () => undefined) }
    const secondSound = { unloadAsync: vi.fn(async () => undefined) }
    const soundConstructor = vi.mocked((await import('expo-av')).Audio.Sound)
    soundConstructor.createAsync = vi
      .fn()
      .mockResolvedValueOnce({ sound: firstSound } as never)
      .mockResolvedValueOnce({ sound: secondSound } as never)

    const renderer = create(createElement(MediaTaskCard, { task: musicTask }))
    await act(async () => undefined)
    renderer.update(
      createElement(MediaTaskCard, {
        task: { ...musicTask, resultUrl: 'https://example.test/generated/music-2.mp3' },
      })
    )
    await act(async () => undefined)

    expect(firstSound.unloadAsync).toHaveBeenCalledOnce()
    await act(async () => renderer.unmount())
    expect(secondSound.unloadAsync).toHaveBeenCalledOnce()
  })

  it('offers a retry action when audio loading fails and keeps image preview behavior', async () => {
    const soundConstructor = vi.mocked((await import('expo-av')).Audio.Sound)
    soundConstructor.createAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ sound: { unloadAsync: vi.fn(async () => undefined) } } as never)

    const renderer = create(createElement(MediaTaskCard, { task: musicTask }))
    await act(async () => undefined)
    await act(async () => findPressable(renderer, '重试播放').props['onPress']())
    await act(async () => undefined)
    expect(soundConstructor.createAsync).toHaveBeenCalledTimes(2)
    await act(async () => renderer.unmount())

    const imageRenderer = create(createElement(MediaTaskCard, { task: imageTask }))
    expect(findPressable(imageRenderer, '预览生成的图片')).toBeDefined()
    expect(soundConstructor.createAsync).toHaveBeenCalledTimes(2)
    await act(async () => imageRenderer.unmount())
  })

  it('keeps the existing cancel action for a running image task', () => {
    mediaActions.cancel.mockReset()
    const renderer = create(
      createElement(MediaTaskCard, { task: { ...imageTask, status: 'running', resultUrl: null } })
    )
    act(() => findPressable(renderer, '停止生成').props['onPress']())
    expect(mediaActions.cancel).toHaveBeenCalledWith(imageTask.id)
    renderer.unmount()
  })
})
