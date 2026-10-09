import type {
  Persona,
  PersonaCandidate,
  PersonaCandidateStatus,
  PersonaInput,
  PersonaPreview,
  PersonaVersion,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 读取助理当前生效的人格；从未保存过时后端返回一份默认值且不落库。 */
export async function getPersona(assistantId: string): Promise<Persona> {
  return (await apiClient.get<Persona>(`/agent/assistants/${assistantId}/persona`)).data
}

/** 保存人格；一次保存生成一个新版本，省略的字段保持原值。 */
export async function updatePersona(assistantId: string, input: PersonaInput): Promise<Persona> {
  return (await apiClient.put<Persona>(`/agent/assistants/${assistantId}/persona`, input)).data
}

/** 列出助理的人格版本历史，供回滚挑选。 */
export async function listPersonaVersions(assistantId: string): Promise<PersonaVersion[]> {
  return (
    await apiClient.get<PersonaVersion[]>(`/agent/assistants/${assistantId}/persona/versions`)
  ).data
}

/** 回滚到指定版本；回滚本身也会生成一个新版本，不会丢失中间状态。 */
export async function rollbackPersona(assistantId: string, version: number): Promise<Persona> {
  return (
    await apiClient.post<Persona>(
      `/agent/assistants/${assistantId}/persona/versions/${String(version)}/rollback`
    )
  ).data
}

/**
 * 取后端真实装配出的人格片段。
 *
 * 预览故意走后端：前端自己拼就要复制一份截断规则，两边一旦漂移预览就在对用户撒谎。
 * 用 POST 而不是 GET：草稿含两段自由文本与最多 20 条禁止话题，放查询串既可能超出
 * URL 长度上限，又会把人格内容写进访问日志。
 * @param assistantId 助理 ID
 * @param draft 编辑器里尚未保存的草稿，走请求体；省略则预览当前已保存的人格。
 *   带上草稿时预览不需要先保存就能反映表单。
 */
export async function getPersonaPreview(
  assistantId: string,
  draft?: PersonaInput
): Promise<PersonaPreview> {
  return (
    await apiClient.post<PersonaPreview>(`/agent/assistants/${assistantId}/persona/preview`, draft)
  ).data
}

/** 列出人格候选项；传 `status` 只看该状态，省略则返回全部。 */
export async function listPersonaCandidates(
  status?: PersonaCandidateStatus
): Promise<PersonaCandidate[]> {
  return (
    await apiClient.get<PersonaCandidate[]>('/agent/persona-candidates', { params: { status } })
  ).data
}

/** 采用候选项：写入人格并生成新版本，候选置为 `accepted`。 */
export async function acceptPersonaCandidate(id: string): Promise<PersonaCandidate> {
  return (await apiClient.post<PersonaCandidate>(`/agent/persona-candidates/${id}/accept`)).data
}

/** 忽略候选项：人格不变，候选置为 `rejected`。 */
export async function rejectPersonaCandidate(id: string): Promise<PersonaCandidate> {
  return (await apiClient.post<PersonaCandidate>(`/agent/persona-candidates/${id}/reject`)).data
}
