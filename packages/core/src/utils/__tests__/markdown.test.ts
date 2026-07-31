import { describe, it, expect } from 'vitest'
import { stripMarkdown } from '../markdown'

describe('stripMarkdown', () => {
  it('移除围栏代码块整体', () => {
    expect(stripMarkdown('前\n```js\nconst a = 1\n```\n后')).toBe('前\n\n后')
  })

  it('保留行内代码的内容，去掉反引号', () => {
    expect(stripMarkdown('用 `npm i` 安装')).toBe('用 npm i 安装')
  })

  it('去掉粗体 / 斜体 / 删除线标记', () => {
    expect(stripMarkdown('**粗** *斜* ~~删~~')).toBe('粗 斜 删')
  })

  it('去掉标题井号', () => {
    expect(stripMarkdown('## 标题\n正文')).toBe('标题\n正文')
  })

  it('去掉无序 / 有序列表标记', () => {
    expect(stripMarkdown('- 一\n* 二\n1. 三')).toBe('一\n二\n三')
  })

  it('链接只保留文案', () => {
    expect(stripMarkdown('见 [文档](https://example.com)')).toBe('见 文档')
  })

  it('去掉引用标记', () => {
    expect(stripMarkdown('> 引用内容')).toBe('引用内容')
  })

  it('首尾空白被裁掉', () => {
    expect(stripMarkdown('\n\n  文本  \n\n')).toBe('文本')
  })

  it('纯文本原样返回', () => {
    expect(stripMarkdown('这是一段普通文字')).toBe('这是一段普通文字')
  })
})
