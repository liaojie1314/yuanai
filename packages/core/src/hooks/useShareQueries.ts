import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createShareLink,
  getShareLink,
  getSharedConversation,
  getSharedMeta,
  revokeShareLink,
  unlockSharedConversation,
  type CreateShareOptions,
  type ShareLink,
  type SharedConversation,
  type SharedConversationMeta,
} from '../api/share.js'

/**
 * 获取指定会话的当前分享链接（不存在时抛错，可通过 `retry: false` + `throwOnError` 控制）
 */
export function useShareLink(convId: string | undefined) {
  return useQuery<ShareLink | null>({
    queryKey: ['share', convId],
    queryFn: async () => {
      if (!convId) return null
      try {
        return await getShareLink(convId)
      } catch {
        return null
      }
    },
    enabled: !!convId,
    staleTime: 30 * 1000,
    retry: false,
  })
}

/** 创建或复用会话分享链接（可传有效期和密码） */
export function useCreateShareLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ convId, opts }: { convId: string; opts?: CreateShareOptions }) =>
      createShareLink(convId, opts ?? {}),
    onSuccess: (link, vars) => {
      qc.setQueryData(['share', vars.convId], link)
    },
  })
}

/** 撤销会话分享链接 */
export function useRevokeShareLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (convId: string) => revokeShareLink(convId),
    onSuccess: (_, convId) => {
      qc.setQueryData(['share', convId], null)
    },
  })
}

/** 匿名访问分享元信息（不含正文） */
export function useSharedMeta(shareToken: string | undefined) {
  return useQuery<SharedConversationMeta>({
    queryKey: ['shared-meta', shareToken],
    queryFn: () => {
      if (!shareToken) throw new Error('missing token')
      return getSharedMeta(shareToken)
    },
    enabled: !!shareToken,
    retry: false,
    staleTime: 60 * 1000,
  })
}

/** 匿名访问分享正文（不含密码校验，需要密码时会 403） */
export function useSharedConversation(shareToken: string | undefined, enabled: boolean = true) {
  return useQuery<SharedConversation>({
    queryKey: ['shared-conversation', shareToken],
    queryFn: () => {
      if (!shareToken) throw new Error('missing token')
      return getSharedConversation(shareToken)
    },
    enabled: !!shareToken && enabled,
    retry: false,
    staleTime: 60 * 1000,
  })
}

/** 使用访问密码解锁分享 */
export function useUnlockSharedConversation(shareToken: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) => {
      if (!shareToken) throw new Error('missing token')
      return unlockSharedConversation(shareToken, password)
    },
    onSuccess: (data) => {
      qc.setQueryData(['shared-conversation', shareToken], data)
    },
  })
}
