import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SkillDraft, SkillInstallationUpdate } from '@yuanai/types'

import {
  activateSkillVersion,
  createSkill,
  createSkillVersion,
  listSkills,
  rollbackSkillVersion,
  updateSkillInstallation,
  validateSkillVersion,
} from '../api/skills.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 获取当前用户的 Skill 管理列表。 */
export function useSkills() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['skills'],
    queryFn: listSkills,
    enabled: Boolean(accessToken),
  })
}

/** 创建 Skill 草稿并刷新管理列表。 */
export function useCreateSkill() {
  return useSkillMutation(createSkill)
}

/** 为指定 Skill 追加草稿版本并刷新管理列表。 */
export function useCreateSkillVersion() {
  return useSkillMutation(({ skillId, input }: { skillId: string; input: SkillDraft }) =>
    createSkillVersion(skillId, input)
  )
}

/** 校验指定 Skill 版本并刷新管理列表。 */
export function useValidateSkillVersion() {
  return useSkillMutation(({ skillId, versionId }: { skillId: string; versionId: string }) =>
    validateSkillVersion(skillId, versionId)
  )
}

/** 激活指定 Skill 版本并刷新管理列表。 */
export function useActivateSkillVersion() {
  return useSkillMutation(({ skillId, versionId }: { skillId: string; versionId: string }) =>
    activateSkillVersion(skillId, versionId)
  )
}

/** 回滚到指定历史 Skill 版本并刷新管理列表。 */
export function useRollbackSkillVersion() {
  return useSkillMutation(({ skillId, versionId }: { skillId: string; versionId: string }) =>
    rollbackSkillVersion(skillId, versionId)
  )
}

/** 设置指定 Skill 的安装范围并刷新管理列表。 */
export function useUpdateSkillInstallation() {
  return useSkillMutation(
    ({ skillId, input }: { skillId: string; input: SkillInstallationUpdate }) =>
      updateSkillInstallation(skillId, input)
  )
}

/** 执行会使 Skill 管理快照失效的变更。 */
function useSkillMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })
}
