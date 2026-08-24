import type { JSX } from 'react'
import { use } from 'react'
import AgentWorkspace from '@/components/agent/AgentWorkspace'

export default function AgentRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>
}): JSX.Element {
  const params = use(searchParams)
  return <AgentWorkspace mode="runs" {...(params.run ? { initialRunId: params.run } : {})} />
}
