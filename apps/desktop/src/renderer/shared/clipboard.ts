/**
 * 优先通过预加载桥写入系统剪贴板；仅在桌面桥异常时降级为 Web API。
 * @param value 要复制的纯文本或 Markdown 源文
 * @returns 实际写入剪贴板时返回 true
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await window.yuanai.clipboard.writeText(value)
    return true
  } catch {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return true
      }

      const fallback = document.createElement('textarea')
      fallback.value = value
      fallback.setAttribute('readonly', '')
      fallback.style.position = 'fixed'
      fallback.style.opacity = '0'
      document.body.append(fallback)
      fallback.select()
      const copied = document.execCommand('copy')
      fallback.remove()
      return copied
    } catch {
      return false
    }
  }
}
