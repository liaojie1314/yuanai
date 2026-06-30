import type { JSX } from 'react'
import { use } from 'react'
import ChatInterface from '@/components/ChatInterface'

export default function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}): JSX.Element {
  const { conversationId } = use(params)
  return <ChatInterface initialConvId={conversationId} />
}
