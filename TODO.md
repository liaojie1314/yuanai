# TODO — 未完成 / 待办

## Desktop 发布验收

- [ ] 在 Windows、macOS 和 Ubuntu 上分别运行 `package:win`、`package:mac`、
      `package:linux` 并安装验证：认证、真实聊天、系统托盘、全局快捷键、深链接和
      Artifact 预览均应正常。
- [ ] 配置 Windows 代码签名、macOS notarization 与 GitHub Releases 更新源；用已发布
      的旧版本验证下载、重启安装和失败回退流程。
- [ ] 语音转写和桌面语音输入按已确认的 Phase 4 范围暂缓，待 Web 后端接口交付后再
      作为独立功能实施。

## Web

- [x] **设置 → 外观与主题**：字号档位驱动到聊天区/输入框/侧栏/设置面板（`--user-font-size` + `!important` 覆盖组件内联 px，档位 12/16/20 px），密度三档差距明显（`--density-gap` 6/20/40 等一整组变量）。相关 CSS 变量集中在 `apps/web/src/app/globals.css`。

- [x] **设置 → 通知设置（前端 + SW）**：`apps/web/public/sw.js` 承担 `push` / `notificationclick`；`apps/web/src/lib/notifications.ts` 统一提供 `playNotificationSound` / `registerNotificationServiceWorker` / `requestNotificationPermission` / `triggerAIReplyNotification`；`ServiceWorkerProvider` 在应用挂载时注册 SW；`SettingsModal` 的「AI 回复通知」开关会同时申请权限。测试步骤：`docs-internal/notifications-testing.md`。
  - [x] **服务端推送（真正后台送达）**：已落地。后端 `push_subscriptions` 表（migration `b2d5f9a1c8e0`）+ `POST /api/v1/notifications/subscribe` / `/unsubscribe` + 公开的 `GET /notifications/vapid-public-key`；AI 流结束时 `chat.py::_generate_sse` 在 `db.commit()` 后调 `push_service.send_to_user`（pywebpush + VAPID，线程池执行，失效订阅 404/410 自动清理），未配置 VAPID 时降级为 no-op。前端 `apps/web/src/lib/push.ts` + `ServiceWorkerProvider` 登录后自动 `pushManager.subscribe` 并上报，设置页「AI 回复通知」开关联动订阅/退订；`sw.js` 前台聚焦时跳过弹窗。集成测试 `backend/tests/integration/test_notifications.py`（11 例）。VAPID 生成 + `curl` 触发验证见 `docs-internal/notifications-testing.md` 第 7 节。

- [x] **临时对话（Temporary chat）**：侧栏头部 Ghost 图标切换；开启后消息仅存内存、不落库、不进侧栏列表；后端无状态端点 `POST /api/v1/chat/stream/temporary`（SSE 协议与 `/chat/stream` 完全一致，前端 `useStream.sendTemporary` 分支复用同一 store）；集成测试 `backend/tests/integration/test_chat.py::TestTemporaryChat`。

- [x] **用户输入框 → 语音输入**：Web Speech API 抽到 `apps/web/src/hooks/useSpeechRecognition.ts`；不支持的浏览器（Firefox）通过 `speech.isSupported` 直接隐藏按钮；识别时 Mic 变红色脉冲、textarea placeholder 改为「正在聆听…」，识别结果按 `result.isFinal` 追加到 textarea 末尾；错误自动 toast。语言默认 `navigator.language`。端侧模型（Whisper.wasm 等）留待二期评估。

- [x] **用户输入框 → 上传附件改为弹出菜单**：Paperclip 按钮切换成弹出菜单（`ch-attach-menu`，沿用项目原生的 fixed-position 下拉模式，未引入 Radix Popover）。三项：
  - **上传文件** — 复用原 `<input type="file">` + `useFileUpload` 分片上传链路
  - **截屏** — `apps/web/src/lib/mediaCapture.ts::captureScreenshot`，走 `getDisplayMedia` → canvas 导出 `image/png`；用户点取消自动 fallback null
  - **摄像头拍照** — `CameraModal` 组件预览 + 拍照，共用同一 `addFilesToQueue` 入口
  - 能力探测：`isScreenCaptureSupported()` / `isCameraSupported()` 不支持时菜单项 disabled 并带 tooltip 说明

- [x] **三方登录（GitHub + Google）**：完整 OAuth 链路已落地。
  - 后端：`app/services/oauth_service.py` 编排 `state → exchange → profile → 关联或建号 → 签 JWT`；`app/api/v1/auth.py` 新增 `GET /auth/github`（302 到 authorize）和 `GET /auth/github/callback`（302 回前端并带 token）
  - 数据模型：`users.github_id` 唯一列 + `hashed_password` 改为可空（migration `f9a3b7c214e5`），OAuth-only 用户走「忘记密码」补设本地密码
  - 前端：`login/page.tsx` GitHub 按钮跳 `${API_BASE_URL}/auth/github`；新建 `app/(auth)/oauth/callback/page.tsx` 读取 token → `getMeWithToken` → `setAuth` → replace 到 `/chat`；`middleware.ts` 把 `/oauth` 加入公开路径
  - 集成测试：`tests/integration/test_oauth.py` 覆盖 authorize URL 生成、新用户创建、邮箱关联现有账户、state 校验、provider 错误透传、state 一次性消费 6 个场景
  - 配置文档：`docs-internal/oauth-setup.md` 记录 OAuth App 申请、环境变量、账号关联规则、扩展到 Google / Apple 的步骤
  - **Google** 已按同一模板扩展：`oauth_service` 泛化为 provider-keyed（`_link_or_create_user(provider, ...)`），新增 `build_google_authorize_url` / `_exchange_google_code_for_token` / `_fetch_google_profile`（`openid email profile` scope，取 OpenID `sub`，要求 `email_verified`）/ `complete_google_callback`；`users.google_id` 列（migration `a1c4e8f0b2d6`）；路由 `GET /auth/google`、`/auth/google/callback`、`DELETE /auth/me/google`；前端登录页启用 Google 按钮、设置页绑定/解绑（`useUnlinkGoogle`）；集成测试 `test_oauth_google.py`（9 例）。文档 `docs-internal/oauth-setup.md`。
  - 微信按钮仍 disabled + tooltip「第三方登录即将开放」（需企业主体认证，二期）；Apple 因 $99/年会员已移除

- [x] **Artifact 面板 → 更完整的代码预览**：已落地。新增 `apps/web/src/components/chat/artifact-runtimes.ts` 集中 esm.sh CDN 地址与各语言 `srcdoc` 模板（React/Vue/Svelte/Markdown/Mermaid）+ 控制台桥；`utils.ts::isRunnableLang` 扩展 jsx/tsx/vue/svelte/markdown/md/mermaid，`buildRunSrcDoc` 按语言分发，新增 `isDataPreviewLang`（json/csv）；`ArtifactPanel.tsx` 增加 JSON 折叠树 + CSV 表格（非 iframe）、可折叠控制台面板（校验不可信 postMessage、按运行重置、限 200 条）、全屏切换、view 模式 CodeMirror 编辑 + 重新运行。iframe 仍 `sandbox="allow-scripts allow-forms"`（不加 `allow-same-origin`），用户代码经 `JSON.stringify` 注入。单测 `__tests__/artifact-runtimes.test.ts`。下述为当初的拆解清单，均已覆盖：
  - **React / Vue / Svelte 单文件预览**：识别 `jsx` / `tsx` / `vue` / `svelte` 代码块 → 在 iframe 内挂载 esm.sh 版本的运行时（`import React from 'https://esm.sh/react'`），在 `<div id="app">` 上渲染；仍走 srcdoc，不联网仅拉 esm.sh CDN
  - **Markdown 预览**：`isRunnableLang` 增加 `markdown` / `md` 分支，用 `marked` + 内置 CSS 直接渲染成静态 HTML 页
  - **Mermaid / 流程图**：识别 ` ```mermaid ` 代码块 → iframe 加载 `mermaid.esm.mjs`，调用 `mermaid.run()` 渲染 SVG
  - **JSON / CSV 表格预览**：`json` 走可折叠 tree 视图（自实现或用 `react-json-view` 但要避免 SSR），`csv` 走 `<table>` 展示
  - **运行时错误反馈**：iframe 内注入 `window.onerror` / `window.onunhandledrejection`，通过 `postMessage` 上抛到父页；面板底部新增一个可折叠的「控制台」面板显示错误 & `console.log/warn/error`（同样劫持后 postMessage）
  - **iframe 尺寸自适应 + 全屏切换**：面板顶部加「全屏」按钮，把 `.ch-artifact-panel` 切成 `position: fixed; inset: 0` 铺满窗口；iframe 保持 `100% × 100%`
  - **代码编辑（可选）**：view 模式下点击代码块可切编辑，改完点「重新运行」重放 srcdoc；用轻量 `codemirror-6` 或 `@codemirror/basic-setup`，避免引入 monaco（体积太大）
  - 对齐现有 CSS class 前缀 `ch-ap-*`；新增控制台面板走 `ch-ap-console-*`；所有第三方 CDN 依赖集中在 `apps/web/src/components/chat/artifact-runtimes.ts` 便于替换/自托管

## backend

- [ ] **实现真正的联网搜索功能**：作为上条 LangGraph agent 的第一个落地 tool。选型：**默认 Tavily**（专为 LLM 优化，返回 answer + 带 score 的 snippet 列表，单次查询成本低）；备选 SerpAPI（Google 结果最全、贵）、Bing Web Search（性价比中间、需 Azure）、Brave Search（隐私+便宜、结果覆盖略差）。需要：
  - `backend/app/services/tools/web_search.py`：LangChain `@tool` 定义，参数 `query: str, max_results: int = 5, search_depth: Literal['basic', 'advanced'] = 'basic'`；调用 `langchain-community` 的 `TavilySearchAPIWrapper`（或裸 httpx）
  - `settings.tavily_api_key` 环境变量；未配置时 `ToolRegistry` 跳过注册，模型看不到该 tool（避免"AI 说要调用但报没 key"）
  - Redis 缓存：查询结果 key=`websearch:{sha1(query)}` TTL 1 小时，控 API 成本；同 query 重复触发直接命中缓存
  - 速率限制：`fastapi-limiter` 或自实现，按 user_id 限制每分钟调用次数（默认 20/min），超限走 tool_call_end `status='error'`
  - SSE 事件：复用已有 `tool_call_start`（name=`web_search`, 参数 args_chunk）→ `tool_call_delta`（流式回填 args JSON）→ `tool_call_end`（`result_preview` 携带前 3 条标题+URL 摘要，完整结果落库 `Message.tool_calls`）
  - 前端 `ToolCallRow` 已能通用渲染，但需要 `web_search` 专属分支：把 result_preview 里的 sources 渲染成可点击链接列表（外链带 `target="_blank" rel="noopener"`），并在正文回答里给 AI 引用的 URL 加上 footnote 编号
  - 后端集成测试：mock TavilySearchAPIWrapper 返回固定 payload，端到端跑 `agent/stream` 断言 tool 事件序列 + 数据库 `Message.tool_calls` 落地正确
