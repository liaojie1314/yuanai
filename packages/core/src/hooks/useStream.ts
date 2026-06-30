import { useCallback, useRef } from 'react'
import { useChatStore, MOCK_RESPONSES } from '../stores/chat.store'

export interface StreamParams {
  convId: string
  content: string
  onStart?: (msgId: string) => void
  onEnd?: () => void
}

export function useStream() {
  const { addUserMessage, startStreaming, appendToken, finalizeStream } = useChatStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const send = useCallback(
    ({ convId, content, onStart, onEnd }: StreamParams) => {
      addUserMessage(convId, content)

      const msgId = startStreaming(convId)
      onStart?.(msgId)

      const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)] ?? ''
      let index = 0

      if (timerRef.current) clearInterval(timerRef.current)

      timerRef.current = setInterval(() => {
        if (index < response.length) {
          appendToken(response[index] ?? '')
          index++
        } else {
          if (timerRef.current) clearInterval(timerRef.current)
          finalizeStream(response)
          onEnd?.()
        }
      }, 18)
    },
    [addUserMessage, startStreaming, appendToken, finalizeStream]
  )

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const { streamingContent } = useChatStore.getState()
    finalizeStream(streamingContent)
  }, [finalizeStream])

  return { send, stop }
}
