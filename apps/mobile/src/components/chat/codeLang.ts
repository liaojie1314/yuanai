/**
 * 将 fence 语言别名归一成 highlight.js 认识的名字。
 * 未知语言回退 text（纯文本，无 grammar 匹配）。
 */
const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  csharp: 'cs',
  'c#': 'cs',
  plaintext: 'text',
  txt: 'text',
}

export function normalizeHighlightLang(lang?: string): string {
  if (!lang) return 'text'
  const key = lang.trim().toLowerCase()
  if (!key) return 'text'
  return ALIASES[key] ?? key
}
