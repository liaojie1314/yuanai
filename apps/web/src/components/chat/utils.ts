import type { Conversation, Message } from '@yuanai/types'
import type { ConvGroup, MockConversation, MockMessage } from '@yuanai/core/stores'

/**
 * 消息对：一条用户消息 + 对应的多个 AI 回复（重新生成产生多版本）。
 */
export interface MsgPair {
  pairKey: string
  userMsg: MockMessage
  assistants: MockMessage[]
}

/**
 * 依据置顶标记与最后活跃时间，将会话归入 pinned/today/yesterday/week 分组。
 */
export function convGroup(conv: Conversation): ConvGroup {
  if (conv.isPinned) return 'pinned'
  const ts = conv.lastMessageAt ?? conv.createdAt
  const age = Date.now() - new Date(ts).getTime()
  if (age < 86_400_000) return 'today'
  if (age < 172_800_000) return 'yesterday'
  return 'week'
}

/**
 * 后端 Conversation → 前端 MockConversation 适配。
 */
export function apiConvToMock(conv: Conversation): MockConversation {
  const ts = conv.lastMessageAt ?? conv.createdAt
  return {
    id: conv.id,
    title: conv.title,
    group: convGroup(conv),
    updatedAt: new Date(ts).getTime(),
  }
}

/**
 * 后端 Message → 前端 MockMessage 适配。
 */
export function apiMsgToMock(msg: Message): MockMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, content: msg.content }],
    ...(msg.thinkingContent ? { thinkContent: msg.thinkingContent } : {}),
    ...(typeof msg.thinkingDurationMs === 'number'
      ? { thinkDurationMs: msg.thinkingDurationMs }
      : {}),
    createdAt: new Date(msg.createdAt).getTime(),
  }
}

/**
 * 判断浏览器是否处于深色主题。
 * SSR 安全：仅在 window 存在时调用。
 */
export function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
}

/**
 * 从消息 parts 数组抽取纯文字内容。
 */
export function getMsgText(msg: MockMessage): string {
  return msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.content ?? '')
    .join('\n')
}

/**
 * 依据用户偏好格式化消息时间戳。
 */
export function formatMsgTime(
  ts: number,
  timeFmt: '24h' | '12h',
  dateFmt: 'ymd' | 'mdy' | 'dmy'
): string {
  const d = new Date(ts)
  const now = new Date()
  const todayStr = now.toDateString()
  const yd = new Date(now)
  yd.setDate(now.getDate() - 1)

  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const timeStr =
    timeFmt === '24h'
      ? `${String(h).padStart(2, '0')}:${m}`
      : `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`

  if (d.toDateString() === todayStr) return timeStr
  if (d.toDateString() === yd.toDateString()) return `昨天 ${timeStr}`

  const y = d.getFullYear()
  const mo = d.getMonth() + 1
  const day = d.getDate()
  const dateStr =
    dateFmt === 'ymd'
      ? `${y}/${mo}/${day}`
      : dateFmt === 'mdy'
        ? `${mo}/${day}/${y}`
        : `${day}/${mo}/${y}`
  return `${dateStr} ${timeStr}`
}

/**
 * 移除常见 Markdown 语法，返回可直接展示的纯文本。
 * 用于"复制纯文本"功能。
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .trim()
}

/**
 * 将扁平消息列表分组为 `(用户消息, AI回复[])` 对。
 * 用户内容相同的相邻对会合并（用于版本切换：重新生成会产生重复用户消息）。
 */
export function buildPairs(msgs: MockMessage[]): MsgPair[] {
  const pairs: MsgPair[] = []
  let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (!msg) {
      i++
      continue
    }
    if (msg.role === 'user') {
      const assistants: MockMessage[] = []
      let j = i + 1
      while (j < msgs.length && msgs[j]?.role === 'assistant') {
        assistants.push(msgs[j] as MockMessage)
        j++
      }
      pairs.push({ pairKey: msg.id, userMsg: msg, assistants })
      i = j
    } else {
      i++
    }
  }
  const merged: MsgPair[] = []
  for (const pair of pairs) {
    const last = merged[merged.length - 1]
    if (last && getMsgText(last.userMsg) === getMsgText(pair.userMsg)) {
      last.assistants.push(...pair.assistants)
    } else {
      merged.push(pair)
    }
  }
  return merged
}

/**
 * 判断代码语言是否支持沙箱运行（HTML/CSS/JS）。
 */
export function isRunnableLang(lang: string): boolean {
  const l = lang.toLowerCase()
  return (
    l === 'html' ||
    l === 'htm' ||
    l === 'css' ||
    l === 'js' ||
    l === 'javascript' ||
    l === 'mjs' ||
    l === 'cjs'
  )
}

/** 代码语言 → 文件扩展名映射，用于下载代码块时生成合适的文件名 */
const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  mjs: 'mjs',
  cjs: 'cjs',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
  c: 'c',
  h: 'h',
  cpp: 'cpp',
  'c++': 'cpp',
  cc: 'cc',
  csharp: 'cs',
  cs: 'cs',
  go: 'go',
  golang: 'go',
  rust: 'rs',
  rs: 'rs',
  ruby: 'rb',
  rb: 'rb',
  php: 'php',
  dart: 'dart',
  scala: 'scala',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  markdown: 'md',
  md: 'md',
  vue: 'vue',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'mk',
  toml: 'toml',
  ini: 'ini',
  lua: 'lua',
  perl: 'pl',
  r: 'r',
  objectivec: 'm',
  haskell: 'hs',
  elixir: 'ex',
  erlang: 'erl',
  clojure: 'clj',
}

/**
 * 根据代码语言推导下载文件的扩展名，未识别的语言回退为 `txt`。
 */
export function langToExtension(lang: string): string {
  return LANG_EXTENSIONS[lang.trim().toLowerCase()] ?? 'txt'
}

/**
 * 根据代码语言构造 iframe `srcdoc` 内容。
 *
 * - HTML → 原样嵌入
 * - CSS → 注入 `<style>`，body 内插入示例段落用于展示
 * - JS → 注入 `<script>`
 */
export function buildRunSrcDoc(lang: string, code: string): string {
  const l = lang.toLowerCase()
  const base =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{margin:0;padding:16px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a2540;background:#fff}</style>'
  if (l === 'html' || l === 'htm') {
    return code.trim().startsWith('<!') ? code : `${base}</head><body>${code}</body></html>`
  }
  if (l === 'css') {
    return `${base}<style>${code}</style></head><body><h1>元 AI 预览</h1><p>已应用上面的样式规则。</p><button>示例按钮</button></body></html>`
  }
  // 默认按 JS 处理；用字符串拼接避免 `</script>` 被 HTML 解析器提前截断
  return (
    `${base}</head><body><div id="app"></div><` + `script>${code}\n</` + `script></body></html>`
  )
}
