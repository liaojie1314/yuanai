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

若关闭浏览器窗口后收到通知：这是**服务端 Web Push** 推送生效（见下文第 7 节）。
未配置 VAPID 密钥时后端推送链路自动降级为 no-op，此时关闭标签页收不到通知属预期。

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

## 7. 服务端 Web Push（真正后台送达）

标签页彻底关闭时也能收到通知，靠后端在 AI 回复结束时主动推送（pywebpush + VAPID）。
链路：前端 `pushManager.subscribe` → `POST /api/v1/notifications/subscribe` 落库 `push_subscriptions`
→ AI 流结束 `chat.py::_generate_sse` 在 `db.commit()` 后调 `push_service.send_to_user`
→ 浏览器 `sw.js` 的 `push` 事件 `showNotification`（前台聚焦时跳过）。

### 7.1 生成 VAPID 密钥对

后端已装 `pywebpush`（含 `py-vapid`）。在 `backend/` 下运行：

```bash
cd backend
uv run python - <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
v = Vapid(); v.generate_keys()
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
pub = v.public_key.public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)
priv = v.private_key.private_numbers().private_value.to_bytes(32, "big")
print("VAPID_PUBLIC_KEY=" + b(pub))
print("VAPID_PRIVATE_KEY=" + b(priv))
PY
```

把两行输出写进 `backend/.env`（私钥切勿提交），再加一行 subject：

```dotenv
VAPID_PUBLIC_KEY=B...         # 也是前端 applicationServerKey，公钥可公开（约 87 位 base64url，无冒号）
VAPID_PRIVATE_KEY=...         # raw 32 字节 base64url，pywebpush 直接接受，切勿泄漏
VAPID_SUBJECT=mailto:admin@yuanai.example   # 见下方说明
```

> **关于 `VAPID_SUBJECT`**：它标识**「本应用服务器」的联系方式**（`mailto:` 邮箱或 `https://` 站点 URL），
> 整个部署**共用一个**、由运维方填写。当推送服务（Chrome→FCM、Firefox→Mozilla 等）发现某台
> 应用服务器行为异常时，据此联系**服务器运营方**——而非终端用户。它**与用户无关**：
> 每个用户/设备的「一份订阅」是浏览器自动生成的 `PushSubscription`（存 `push_subscriptions` 表），
> 不涉及 subject。本地开发用占位邮箱即可，生产环境建议填真实可达邮箱。
>
> **前端无需任何 VAPID 配置**：公钥由前端在运行时经 `GET /notifications/vapid-public-key` 拉取
> 后作 `applicationServerKey`；改密钥只需改后端 `.env` 并重启，前端零改动。

重启后端。未配置这三个变量时 `push_service.send_to_user` 直接返回 0（no-op），
`GET /notifications/vapid-public-key` 返回空串，前端不会发起订阅——属预期降级。

### 7.2 登记订阅

前端 + 后端都起来后，浏览器打开 `http://localhost:3000` 登录，进入
**设置 → 通知设置**，开启「AI 回复通知」并授予权限。此时 `ServiceWorkerProvider`
会调用 `pushManager.subscribe` 并 `POST /notifications/subscribe`。核对：

```bash
# 用登录后拿到的 access_token（DevTools → Application → Local Storage → yuanai-auth）
TOKEN=<access_token>
curl -s http://localhost:8000/api/v1/notifications/vapid-public-key   # 应回非空 publicKey
# DB 里应出现一行订阅
docker compose exec postgres psql -U yuanai -d yuanai -c \
  "select left(endpoint,40), left(p256dh,12) from push_subscriptions;"
```

### 7.3 触发一次推送验证

**端到端**：保持登录，发一条消息后立刻**关闭该标签页**，等 AI 回复结束——
几秒后系统托盘应弹出「元AI · AI 回复已完成」，点击回到 `/chat/{会话id}`。

**直接触发**（不经聊天，快速验证推送本身）：在 `backend/` 下

```bash
cd backend
uv run python - <<'PY'
import asyncio, uuid
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.push_subscription import PushSubscription
from app.services import push_service

async def main():
    async with AsyncSessionLocal() as db:
        sub = (await db.execute(select(PushSubscription))).scalars().first()
        if not sub:
            print("没有订阅，先在浏览器开启通知开关"); return
        n = await push_service.send_to_user(
            db, sub.user_id,
            {"title": "元AI", "body": "手动推送测试", "url": "/chat"},
        )
        print(f"已向 user={sub.user_id} 推送 {n} 条")

asyncio.run(main())
PY
```

浏览器（哪怕标签在后台/已关闭，只要 SW 存活）应弹出「手动推送测试」。
若 endpoint 已过期，`send_to_user` 会收到 404/410 并自动清理该订阅。

### 7.4 关闭开关

设置里关掉「AI 回复通知」会调用 `removePushSubscription`：
`POST /notifications/unsubscribe` 删库 + 浏览器 `subscription.unsubscribe()`。之后不再收到后台推送。

## 常见问题

- **权限已 denied，怎么恢复？** 浏览器地址栏左侧锁图标 → 站点设置 → 通知 → 允许，或彻底重置权限后重新走开关流程。
- **换浏览器测试**：SW 与通知偏好都是按 origin+浏览器隔离，需要在每个环境重新走一遍第 3 步。
- **iOS Safari**：桌面通知支持有限；WebAudio 需用户手势唤起（点开关时的开关点击本身满足）。
