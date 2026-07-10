/**
 * 移动端 i18n messages（占位）。
 *
 * Phase 3 后续 UI 阶段会把 apps/web 现有的 messages json 抽到共享目录 packages/i18n
 * 由两端复用；v1 阶段先只保留 mobile 需要的极少数键，避免阻塞脚手架落地。
 */
export const zhCN = {
  common: {
    appName: '元AI',
    loading: '加载中…',
    retry: '重试',
    cancel: '取消',
    ok: '确定',
  },
  auth: {
    loginRequired: '请先登录',
  },
  chat: {
    newChat: '新对话',
    inputPlaceholder: '和元AI聊聊…',
  },
} as const
