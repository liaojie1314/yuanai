/**
 * 移除常见 Markdown 语法，返回可直接展示的纯文本。
 * 用于「复制纯文本」功能，Web / Mobile 共用。
 *
 * 只做正则层面的语法剥离，不建 AST：复制场景对保真度要求低，
 * 而引入 markdown parser 会把 `packages/core` 拖上一个重依赖。
 *
 * @param md - 原始 Markdown 文本
 * @returns 去掉围栏代码块与常见行内/块级标记后的纯文本
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
