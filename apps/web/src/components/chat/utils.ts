import type { Conversation, Message } from '@yuanai/types'
import type { ConvGroup, MockConversation, MockMessage } from '@yuanai/core/stores'

export { buildRunSrcDoc, isRunnableLang } from '@yuanai/core'

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
    ...(msg.files.length > 0 ? { files: msg.files } : {}),
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
 * 实现已下沉到 `packages/core`（`utils/time.ts`），与移动端共用同一份。
 */
export { formatMsgTime } from '@yuanai/core/utils'

/**
 * 移除常见 Markdown 语法，返回可直接展示的纯文本（用于"复制纯文本"）。
 * 实现已下沉到 `packages/core`，与移动端共用同一份；此处保留导出以免改动调用点。
 */
export { stripMarkdown } from '@yuanai/core/utils'

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
 * 判断代码语言是否走「数据预览」分支（非 iframe，直接在面板内渲染）。
 *
 * JSON 渲染为可折叠树，CSV 渲染为表格。
 */
export function isDataPreviewLang(lang: string): boolean {
  const l = lang.toLowerCase()
  return l === 'json' || l === 'csv'
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
 * 常见语言别名 → Prism（refractor）规范语言 key 的映射。
 *
 * `PrismAsyncLight` 只会为 refractor 中登记的规范 key 异步加载语法，别名不会命中，
 * 于是像 `html`（Prism 归为 `markup`）、`ts`、`sh`、`yml`、`py` 等常见写法会退化成纯文本。
 * 这里把别名归一到规范 key，让高亮覆盖到这些语言。仅收录会「不一致」的别名，
 * 已与规范 key 同名的（javascript / css / json / python / go 等）无需列出。
 */
const PRISM_LANG_ALIASES: Record<string, string> = {
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  xhtml: 'markup',
  svg: 'markup',
  rss: 'markup',
  vue: 'markup',
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  shellsession: 'bash',
  yml: 'yaml',
  py: 'python',
  py3: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  cs: 'csharp',
  'c#': 'csharp',
  dotnet: 'csharp',
  md: 'markdown',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  dockerfile: 'docker',
  yamlfrontmatter: 'yaml',
  objc: 'objectivec',
  'objective-c': 'objectivec',
  proto: 'protobuf',
  hs: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  pl: 'perl',
  gql: 'graphql',
  tf: 'hcl',
  terraform: 'hcl',
  vb: 'visualBasic',
}

/**
 * 把用户/模型给出的语言标识归一为 Prism 规范 key，供 `CodeHighlight` 高亮使用。
 *
 * 先小写去空白，命中别名表则返回规范 key，否则原样返回（已是规范 key 或 Prism 未收录）。
 */
export function normalizePrismLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  return PRISM_LANG_ALIASES[l] ?? l
}
