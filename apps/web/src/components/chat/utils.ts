import type { Conversation, Message } from '@yuanai/types'
import type { ConvGroup, MockConversation, MockMessage } from '@yuanai/core/stores'
import {
  buildHtmlDoc,
  buildCssDoc,
  buildJsDoc,
  buildReactDoc,
  buildVueDoc,
  buildSvelteDoc,
  buildMarkdownDoc,
  buildMermaidDoc,
} from './artifact-runtimes'

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
 * 判断代码语言是否支持 iframe 沙箱运行。
 *
 * 覆盖 HTML/CSS/JS 及需运行时渲染的 JSX/TSX、Vue、Svelte、Markdown、Mermaid。
 * JSON/CSV 不在此列——它们走非 iframe 的数据预览分支（见 {@link isDataPreviewLang}）。
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
    l === 'cjs' ||
    l === 'jsx' ||
    l === 'tsx' ||
    l === 'vue' ||
    l === 'svelte' ||
    l === 'markdown' ||
    l === 'md' ||
    l === 'mermaid'
  )
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

/**
 * 根据代码语言构造 iframe `srcdoc` 内容。
 *
 * 按小写语言分发到 `artifact-runtimes.ts` 中对应的文档模板；所有产物均已在
 * `<head>` 注入控制台桥。未识别语言回退为 JS 运行时。
 */
export function buildRunSrcDoc(lang: string, code: string): string {
  const l = lang.toLowerCase()
  switch (l) {
    case 'html':
    case 'htm':
      return buildHtmlDoc(code)
    case 'css':
      return buildCssDoc(code)
    case 'js':
    case 'javascript':
    case 'mjs':
    case 'cjs':
      return buildJsDoc(code)
    case 'jsx':
    case 'tsx':
      return buildReactDoc(code)
    case 'vue':
      return buildVueDoc(code)
    case 'svelte':
      return buildSvelteDoc(code)
    case 'markdown':
    case 'md':
      return buildMarkdownDoc(code)
    case 'mermaid':
      return buildMermaidDoc(code)
    default:
      return buildJsDoc(code)
  }
}
