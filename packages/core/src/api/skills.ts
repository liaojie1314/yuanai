import type {
  Skill,
  SkillDraft,
  SkillEvaluation,
  SkillInstallation,
  SkillInstallationUpdate,
  SkillSuggestion,
  SkillVersion,
} from '@yuanai/types'

import { apiClient } from './client.js'

/** 列出当前用户可管理的 Skill。 */
export async function listSkills(): Promise<Skill[]> {
  return (await apiClient.get<Skill[]>('/skills')).data
}

/** 列出由重复成功任务归纳出的 Skill 候选。 */
export async function listSkillSuggestions(): Promise<SkillSuggestion[]> {
  return (await apiClient.get<SkillSuggestion[]>('/skills/suggestions')).data
}

/** 创建一个 Skill 及其首个不可变草稿版本。 */
export async function createSkill(input: SkillDraft): Promise<Skill> {
  return (await apiClient.post<Skill>('/skills', input)).data
}

/** 为已有 Skill 追加一个不可变草稿版本。 */
export async function createSkillVersion(skillId: string, input: SkillDraft): Promise<Skill> {
  return (await apiClient.post<Skill>(`/skills/${skillId}/versions`, input)).data
}

/** 校验 Skill 草稿所引用的工具、版本和风险上限。 */
export async function validateSkillVersion(
  skillId: string,
  versionId: string
): Promise<SkillVersion> {
  return (await apiClient.post<SkillVersion>(`/skills/${skillId}/versions/${versionId}/validate`))
    .data
}

/** 对 Skill 版本重放静态契约评测；替换活动版本前必须通过。 */
export async function evaluateSkillVersion(
  skillId: string,
  versionId: string
): Promise<SkillEvaluation> {
  return (
    await apiClient.post<SkillEvaluation>(`/skills/${skillId}/versions/${versionId}/evaluate`)
  ).data
}

/** 显式激活一个已验证的 Skill 版本。 */
export async function activateSkillVersion(skillId: string, versionId: string): Promise<Skill> {
  return (await apiClient.post<Skill>(`/skills/${skillId}/versions/${versionId}/activate`)).data
}

/** 将已验证的历史版本回滚为当前活动版本。 */
export async function rollbackSkillVersion(skillId: string, versionId: string): Promise<Skill> {
  return (await apiClient.post<Skill>(`/skills/${skillId}/versions/${versionId}/rollback`)).data
}

/** 设置活动 Skill 的全局或指定助理安装范围。 */
export async function updateSkillInstallation(
  skillId: string,
  input: SkillInstallationUpdate
): Promise<SkillInstallation> {
  return (await apiClient.put<SkillInstallation>(`/skills/${skillId}/installations`, input)).data
}
