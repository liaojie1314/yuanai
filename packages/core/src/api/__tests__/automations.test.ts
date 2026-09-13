import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
} from '../automations.js'

const automation = {
  id: 'automation-1',
  userId: 'user-1',
  assistantId: 'assistant-1',
  name: 'Daily brief',
  goal: 'Summarize today',
  model: null,
  maxSteps: 12,
  timezone: 'UTC',
  status: 'active' as const,
  trigger: {
    id: 'trigger-1',
    automationId: 'automation-1',
    triggerType: 'cron' as const,
    cronExpression: '0 9 * * *',
    scheduledAt: null,
    nextRunAt: '2026-09-14T09:00:00Z',
    lastRunAt: null,
    occurrence: 0,
  },
  runs: [],
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
}

const run = {
  id: 'automation-run-1',
  automationId: 'automation-1',
  userId: 'user-1',
  agentRunId: 'run-1',
  occurrenceKey: 'automation:automation-1:manual:1',
  scheduledFor: '2026-09-13T00:00:00Z',
  status: 'queued' as const,
  waitDeadline: null,
  waitReason: null,
  waitNotifiedAt: null,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
}

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  if (config.url === '/automations')
    return respond(config, config.method === 'post' ? automation : [automation], 201)
  if (config.url === '/automations/automation-1/run-now') return respond(config, run, 202)
  if (config.url?.endsWith('/pause') || config.url?.endsWith('/resume'))
    return respond(config, automation)
  if (config.url === '/automations/automation-1') return respond(config, undefined, 204)
  throw new Error(`Unexpected request ${config.method} ${config.url}`)
}

describe('automations API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('uses the guarded automation lifecycle paths and payloads', async () => {
    await expect(listAutomations()).resolves.toEqual([automation])
    await expect(
      createAutomation({
        assistantId: 'assistant-1',
        name: 'Daily brief',
        goal: 'Summarize today',
        timezone: 'UTC',
        trigger: { triggerType: 'cron', cronExpression: '0 9 * * *' },
      })
    ).resolves.toEqual(automation)
    await expect(pauseAutomation('automation-1')).resolves.toEqual(automation)
    await expect(resumeAutomation('automation-1')).resolves.toEqual(automation)
    await expect(runAutomationNow('automation-1')).resolves.toEqual(run)
    await expect(deleteAutomation('automation-1')).resolves.toBeUndefined()

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/automations',
      'post:/automations',
      'post:/automations/automation-1/pause',
      'post:/automations/automation-1/resume',
      'post:/automations/automation-1/run-now',
      'delete:/automations/automation-1',
    ])
  })
})
