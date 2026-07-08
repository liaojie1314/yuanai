# Web 通知功能测试指南

本文档描述如何验证 Web 端 Service Worker + 系统通知 + 提示音的完整链路。
覆盖代码位置：

- `apps/web/public/sw.js` — Service Worker，承担 `push` / `notificationclick`
- `apps/web/src/lib/notifications.ts` — 主线程通知工具（音效、SW 注册、权限、触发）
- `apps/web/src/providers/ServiceWorkerProvider.tsx` — 应用启动时注册 SW
- `apps/web/src/components/settings/SettingsModal.tsx` — 通知偏好 UI
- `apps/web/src/components/ChatInterface.tsx` — 流结束时调用 `triggerAIReplyNotification`

## 前置条件

系统通知 API 与 Service Worker 都要求「安全上下文」：

- **HTTPS**：生产环境必须。
- **`http://localhost`**：本地开发允许。
- **裸 HTTP（局域网 IP、非 localhost 域名）**：不允许，浏览器会拒绝。

## 步骤

### 1. 启动开发环境

```bash
pnpm dev  # 或 pnpm --filter web dev
```

访问 `http://localhost:3000`，登录进入聊天页。

### 2. 检查 Service Worker 是否注册成功

浏览器 DevTools → Application → Service Workers：

- 应看到 `sw.js`，Scope 为 `/`，Status 为 **activated and is running**。
- Console 无相关 error（若失败会打印 registration warn，无 error）。

若未看到：确认 URL 是 `localhost` 或 HTTPS，硬刷新（Ctrl+Shift+R）后重试。

### 3. 授予通知权限

- 打开 **设置 → 通知设置**。
- 打开「浏览器通知」开关。
- 首次开启会触发浏览器权限弹窗，选择 **Allow**。

对照检查：

- Allow → 无 toast，DevTools 中 `Notification.permission === 'granted'`。
- Deny → toast 提示 "浏览器已禁止通知"。
- 不支持 → toast 提示 "当前浏览器不支持系统通知"（如 iOS Safari webview）。

### 4. 触发一次「AI 回复完成」

在开着「浏览器通知」+「AI 回复通知」的前提下：

1. 发一条消息。
2. **立刻切到其它标签页或最小化窗口**（使 `document.hidden === true`）。
3. 等待 AI 回复结束。

预期：

- 系统托盘弹出「元AI · AI 回复已完成」通知。
- 通知点击后自动回到元AI 标签，并触发一次 WebAudio 提示音（若同时勾选「声音提示」）。

若关闭浏览器窗口后**没有**收到通知：这是预期行为——目前后端未实现 Web Push 推送端点，
SW 的 `push` 事件监听器为「预留链路」。真正的后台推送需后端提供 subscribe/推送服务，
详见 `TODO.md · Web 通知` 里的服务端待办。

### 5. 手动模拟一次 push 事件（可选）

在没有后端推送时，也可以直接在 DevTools → Application → Service Workers 面板：

1. 找到 `sw.js`。
2. 点击 "Push" 输入框，填入：
   ```json
   { "title": "元AI", "body": "测试推送", "url": "/chat" }
   ```
3. 点 "Push" 按钮。

预期：立刻收到系统通知，点击后跳转 `/chat`。

### 6. 关掉开关的对照测试

- 关闭「声音提示」→ 回复完成后 **不** 播放音频。
- 关闭「AI 回复通知」→ 回复完成后 **不** 弹系统通知（即使标签在后台）。
- 关闭「浏览器通知」→ 同上。

三个开关的偏好都存 `localStorage`，键前缀 `notif_`（`notif_browser` / `notif_sound` / `notif_ai`）。
清空 localStorage 后默认 `browser=false, sound=false, ai=true`（与 SettingsModal 保持一致）。

## 常见问题

- **权限已 denied，怎么恢复？** 浏览器地址栏左侧锁图标 → 站点设置 → 通知 → 允许，或彻底重置权限后重新走开关流程。
- **换浏览器测试**：SW 与通知偏好都是按 origin+浏览器隔离，需要在每个环境重新走一遍第 3 步。
- **iOS Safari**：桌面通知支持有限；WebAudio 需用户手势唤起（点开关时的开关点击本身满足）。
