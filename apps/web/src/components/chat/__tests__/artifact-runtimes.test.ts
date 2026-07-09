import { describe, it, expect } from 'vitest'
import {
  ESM_CDN,
  CONSOLE_BOOTSTRAP,
  ARTIFACT_MSG_SOURCE,
  buildReactDoc,
  buildMarkdownDoc,
  buildMermaidDoc,
} from '../artifact-runtimes'
import { isRunnableLang, isDataPreviewLang, buildRunSrcDoc, normalizePrismLang } from '../utils'

/** 控制台桥标记：所有模板 head 必含，用于确认桥被注入 */
const BOOTSTRAP_MARKER = ARTIFACT_MSG_SOURCE

describe('artifact-runtimes 文档模板', () => {
  it('buildReactDoc 含 esm.sh React URL、控制台桥与 JSON 编码的用户代码', () => {
    const code = 'export default function App(){return <h1>hi</h1>}'
    const doc = buildReactDoc(code)
    expect(doc).toContain(ESM_CDN.react)
    expect(doc).toContain(ESM_CDN.babel)
    expect(doc).toContain(BOOTSTRAP_MARKER)
    expect(doc).toContain(CONSOLE_BOOTSTRAP)
    expect(doc).toContain(JSON.stringify(code).replace(/</g, '\\u003c'))
  })

  it('buildMarkdownDoc 含 esm.sh marked URL、控制台桥与用户代码', () => {
    const code = '# 标题\n\n正文'
    const doc = buildMarkdownDoc(code)
    expect(doc).toContain(ESM_CDN.marked)
    expect(doc).toContain(BOOTSTRAP_MARKER)
    expect(doc).toContain(JSON.stringify(code))
  })

  it('buildMermaidDoc 含 esm.sh mermaid URL、控制台桥与用户代码', () => {
    const code = 'graph TD; A-->B'
    const doc = buildMermaidDoc(code)
    expect(doc).toContain(ESM_CDN.mermaid)
    expect(doc).toContain(BOOTSTRAP_MARKER)
    expect(doc).toContain(JSON.stringify(code))
  })

  it('含 </script> 的用户代码被转义，不会污染宿主脚本', () => {
    const code = 'const s = "</script><script>alert(1)"'
    const doc = buildReactDoc(code)
    expect(doc).not.toContain('</script><script>alert(1)')
    expect(doc).toContain('\\u003c/script>')
  })
})

describe('语言分类', () => {
  it('isRunnableLang 覆盖新增运行时语言', () => {
    expect(isRunnableLang('mermaid')).toBe(true)
    expect(isRunnableLang('vue')).toBe(true)
    expect(isRunnableLang('tsx')).toBe(true)
    expect(isRunnableLang('svelte')).toBe(true)
    expect(isRunnableLang('markdown')).toBe(true)
    expect(isRunnableLang('html')).toBe(true)
  })

  it('JSON 不可运行，但属于数据预览语言', () => {
    expect(isRunnableLang('json')).toBe(false)
    expect(isDataPreviewLang('json')).toBe(true)
    expect(isDataPreviewLang('csv')).toBe(true)
    expect(isDataPreviewLang('html')).toBe(false)
  })
})

describe('buildRunSrcDoc 分发', () => {
  it('按语言分发到对应模板并注入控制台桥', () => {
    expect(buildRunSrcDoc('tsx', 'x')).toContain(ESM_CDN.react)
    expect(buildRunSrcDoc('vue', 'x')).toContain(ESM_CDN.vue)
    expect(buildRunSrcDoc('mermaid', 'x')).toContain(ESM_CDN.mermaid)
    expect(buildRunSrcDoc('html', '<h1>demo</h1>')).toContain('<h1>demo</h1>')
    expect(buildRunSrcDoc('css', 'body{}')).toContain(BOOTSTRAP_MARKER)
  })
})

describe('normalizePrismLang 语言别名归一', () => {
  it('把常见别名映射到 Prism 规范 key（否则 PrismAsyncLight 不加载语法）', () => {
    expect(normalizePrismLang('html')).toBe('markup')
    expect(normalizePrismLang('HTM')).toBe('markup')
    expect(normalizePrismLang('xml')).toBe('markup')
    expect(normalizePrismLang('vue')).toBe('markup')
    expect(normalizePrismLang('ts')).toBe('typescript')
    expect(normalizePrismLang('js')).toBe('javascript')
    expect(normalizePrismLang('sh')).toBe('bash')
    expect(normalizePrismLang('shell')).toBe('bash')
    expect(normalizePrismLang('yml')).toBe('yaml')
    expect(normalizePrismLang('py')).toBe('python')
    expect(normalizePrismLang('c++')).toBe('cpp')
    expect(normalizePrismLang('cs')).toBe('csharp')
    expect(normalizePrismLang('golang')).toBe('go')
    expect(normalizePrismLang('vb')).toBe('visualBasic')
  })

  it('已是规范 key 或未收录的语言原样返回（小写去空白）', () => {
    expect(normalizePrismLang('javascript')).toBe('javascript')
    expect(normalizePrismLang('  Python  ')).toBe('python')
    expect(normalizePrismLang('json')).toBe('json')
    expect(normalizePrismLang('rust')).toBe('rust')
    expect(normalizePrismLang('unknownlang')).toBe('unknownlang')
  })
})
