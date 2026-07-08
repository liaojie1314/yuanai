/**
 * 通知相关工具：WebAudio 提示音、Service Worker 注册。
 *
 * SPA 主线程调用 {@link playNotificationSound} 在页面可见时给出音频反馈；
 * SW（`public/sw.js`）在 `notificationclick` 事件中通过 postMessage 回主线程后
 * 由主线程复用同一函数播放。
 */

/**
 * 播放一个短促的 sine 提示音（880Hz → 660Hz，约 400ms）。
 *
 * 使用 WebAudio API，无外部音频文件依赖；
 * 环境不支持（SSR / 隐私模式）时静默失败。
 */
export function playNotificationSound(): void {
  if (typeof window === 'undefined') return
  try {
    const AudioCtor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const ctx = new AudioCtor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch {
    /* AudioContext not available */
  }
}

/**
 * 首次进入应用时注册 Service Worker（`/sw.js`）。
 *
 * SW 主要负责：
 * - `push` 事件（未来接入 Web Push 服务端推送）→ 调用 `showNotification`
 * - `notificationclick` 事件 → focus 已打开的标签或新开一个
 * 目前后端暂未提供 push 端点，SW 仅承担 notificationclick 分发能力；
 * 客户端主动 `new Notification()` 依旧在 `triggerNotifications` 中触发。
 *
 * 仅在 HTTPS 或 localhost 环境下工作；不支持环境静默返回。
 */
export function registerNotificationServiceWorker(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  // 主线程收到 SW 发来的音效请求时播放提示音（用户点击通知回到页面）
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string } | undefined
    if (data?.type === 'PLAY_NOTIFICATION_SOUND') {
      playNotificationSound()
    }
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* 注册失败静默：SW 不是关键链路，功能优雅降级为纯客户端通知 */
    })
  })
}

/**
 * 请求浏览器通知权限。
 *
 * - 支持环境（HTTPS + `Notification` API）返回最终 permission 状态；
 * - 不支持环境返回 `'unsupported'`。
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  return await Notification.requestPermission()
}

/**
 * 触发一次「AI 回复完成」通知——按 localStorage 中的开关决定发声/发桌面通知。
 *
 * - 「声音提示」= `notif_sound`：无论前台后台都播放音效
 * - 「AI 回复通知」= `notif_ai`：仅在标签处于后台（`document.hidden`）时弹系统通知
 *   （前台弹通知会遮挡内容且用户已经在看，无意义）
 *
 * 桌面通知优先走 SW（后台标签也能弹），SW 未激活时回退到主线程 `new Notification()`。
 * 权限未授予时静默返回；权限申请由 SettingsModal 中开关触发时完成。
 */
export function triggerAIReplyNotification(): void {
  if (typeof window === 'undefined') return
  const soundOn = localStorage.getItem('notif_sound') === 'true'
  const aiOn = localStorage.getItem('notif_ai') === 'true'
  if (soundOn) playNotificationSound()
  if (!aiOn) return
  if (!document.hidden) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const title = '元AI'
  const options: NotificationOptions = {
    body: 'AI 回复已完成',
    icon: '/favicon.ico',
    tag: 'yuanai-ai-reply',
  }

  // 优先通过 SW 展示（关闭标签或最小化时也能弹）
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, options))
      .catch(() => {
        try {
          new Notification(title, options)
        } catch {
          /* fallback failed */
        }
      })
  } else {
    try {
      new Notification(title, options)
    } catch {
      /* Notification unavailable */
    }
  }
}
