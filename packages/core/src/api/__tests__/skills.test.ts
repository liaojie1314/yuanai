import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client.js'
import {
  activateSkillVersion,
  createSkill,
  createSkillVersion,
  evaluateSkillVersion,
  listSkills,
  listSkillSuggestions,
  rollbackSkillVersion,
  updateSkillInstallation,
  validateSkillVersion,
} from '../skills.js'

const skill = {
  id: 'skill-1',
  userId: 'user-1',
  slug: 'yuanai.research.brief',
  name: 'Research Brief',
  description: 'Build a cited brief',
  currentVersionId: 'version-1',
  versions: [],
  installations: [],
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
}

const version = {
  id: 'version-1',
  skillId: 'skill-1',
  version: '1.0.0',
  manifestText: 'id: yuanai.research.brief',
  skillMd: '# Research Brief',
  contentHash: 'hash',
  requiredTools: ['calculate@^1'],
  riskCeiling: 'read',
  status: 'validated',
  validationResult: { valid: true },
  validationErrors: [],
  createdAt: '2026-09-11T00:00:00Z',
  validatedAt: '2026-09-11T00:00:00Z',
  latestEvaluation: null,
}

const evaluation = {
  id: 'evaluation-1',
  skillId: 'skill-1',
  versionId: 'version-1',
  status: 'passed',
  mode: 'static_contract',
  caseResults: [{ name: 'manifest_contract', status: 'passed', detail: 'ok' }],
  totalCases: 6,
  passedCases: 6,
  passRate: '1.0000',
  estimatedCostUsd: null,
  avgSteps: null,
  durationMs: 3,
  createdAt: '2026-09-11T00:00:00Z',
}

const suggestion = {
  slug: 'experience.calculate.1a2b3c4d',
  name: '统计销售额',
  description: '由 3 次成功任务归纳：calculate',
  occurrences: 3,
  runIds: ['run-1', 'run-2', 'run-3'],
  steps: ['calculate'],
  parameters: ['calculate.expression'],
  requiredTools: ['calculate@^1'],
  riskCeiling: 'read',
  manifest: 'id: experience.calculate.1a2b3c4d',
  skillMd: '# 统计销售额',
}

const installation = {
  id: 'installation-1',
  skillId: 'skill-1',
  scope: 'global',
  assistantId: null,
  createdAt: '2026-09-11T00:00:00Z',
}

let requests: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { config, data, headers: {}, status, statusText: 'OK' }
}

const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  requests.push(config)
  const url = config.url ?? ''
  if (url === '/skills') return respond(config, config.method === 'post' ? skill : [skill], 201)
  if (url === '/skills/suggestions') return respond(config, [suggestion])
  if (url.endsWith('/evaluate')) return respond(config, evaluation)
  if (url === '/skills/skill-1/versions') return respond(config, skill, 201)
  if (url.endsWith('/validate')) return respond(config, version)
  if (url.endsWith('/activate') || url.endsWith('/rollback')) return respond(config, skill)
  if (url === '/skills/skill-1/installations') return respond(config, installation)
  throw new Error(`Unexpected request ${config.method} ${url}`)
}

describe('skills API', () => {
  beforeEach(() => {
    requests = []
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('sends the draft and version lifecycle requests with stable paths', async () => {
    await expect(createSkill({ manifest: 'manifest', skillMd: '# Skill' })).resolves.toEqual(skill)
    await expect(
      createSkillVersion('skill-1', { manifest: 'manifest-2', skillMd: '# v2' })
    ).resolves.toEqual(skill)
    await expect(validateSkillVersion('skill-1', 'version-1')).resolves.toEqual(version)
    await expect(evaluateSkillVersion('skill-1', 'version-1')).resolves.toEqual(evaluation)
    await expect(activateSkillVersion('skill-1', 'version-1')).resolves.toEqual(skill)
    await expect(rollbackSkillVersion('skill-1', 'version-1')).resolves.toEqual(skill)

    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'post:/skills',
      'post:/skills/skill-1/versions',
      'post:/skills/skill-1/versions/version-1/validate',
      'post:/skills/skill-1/versions/version-1/evaluate',
      'post:/skills/skill-1/versions/version-1/activate',
      'post:/skills/skill-1/versions/version-1/rollback',
    ])
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      manifest: 'manifest',
      skillMd: '# Skill',
    })
  })

  it('lists skills and updates a selected installation scope', async () => {
    await expect(listSkills()).resolves.toEqual([skill])
    await expect(updateSkillInstallation('skill-1', { scope: 'global' })).resolves.toEqual(
      installation
    )
    expect(requests[1]?.method).toBe('put')
    expect(JSON.parse(String(requests[1]?.data))).toEqual({ scope: 'global' })
  })

  it('reads experience-derived suggestions from a dedicated path', async () => {
    await expect(listSkillSuggestions()).resolves.toEqual([suggestion])
    expect(requests.map((request) => `${request.method}:${request.url}`)).toEqual([
      'get:/skills/suggestions',
    ])
  })
})
