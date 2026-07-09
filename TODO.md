# TODO — 未完成 / 待办

## Web

- [x] **设置 → 外观与主题**：字号档位驱动到聊天区/输入框/侧栏/设置面板（`--user-font-size` + `!important` 覆盖组件内联 px，档位 12/16/20 px），密度三档差距明显（`--density-gap` 6/20/40 等一整组变量）。相关 CSS 变量集中在 `apps/web/src/app/globals.css`。

- [x] **设置 → 通知设置（前端 + SW）**：`apps/web/public/sw.js` 承担 `push` / `notificationclick`；`apps/web/src/lib/notifications.ts` 统一提供 `playNotificationSound` / `registerNotificationServiceWorker` / `requestNotificationPermission` / `triggerAIReplyNotification`；`ServiceWorkerProvider` 在应用挂载时注册 SW；`SettingsModal` 的「AI 回复通知」开关会同时申请权限。测试步骤：`docs-internal/notifications-testing.md`。
  - [ ] **服务端推送（真正后台送达）**：目前 SW 已接入 `push` 事件但后端未提供订阅端点，标签页彻底关闭时仍收不到通知。仍需：
    - 后端新增 `/api/v1/notifications/subscribe`（保存 Web Push Subscription JSON 到新表 `push_subscriptions`）和 `/unsubscribe`
    - AI 流结束时服务端主动向所有活跃 subscription 推送（使用 pywebpush + VAPID 密钥）
    - 前端在 `ServiceWorkerProvider` 里读取 SW registration 调用 `pushManager.subscribe({applicationServerKey})`，把 subscription POST 给后端
    - 补一段测试文档：如何生成 VAPID keypair、本地用 `curl` 触发一次推送验证链路

- [x] **临时对话（Temporary chat）**：侧栏头部 Ghost 图标切换；开启后消息仅存内存、不落库、不进侧栏列表；后端无状态端点 `POST /api/v1/chat/stream/temporary`（SSE 协议与 `/chat/stream` 完全一致，前端 `useStream.sendTemporary` 分支复用同一 store）；集成测试 `backend/tests/integration/test_chat.py::TestTemporaryChat`。

- [x] **用户输入框 → 语音输入**：Web Speech API 抽到 `apps/web/src/hooks/useSpeechRecognition.ts`；不支持的浏览器（Firefox）通过 `speech.isSupported` 直接隐藏按钮；识别时 Mic 变红色脉冲、textarea placeholder 改为「正在聆听…」，识别结果按 `result.isFinal` 追加到 textarea 末尾；错误自动 toast。语言默认 `navigator.language`。端侧模型（Whisper.wasm 等）留待二期评估。

- [x] **用户输入框 → 上传附件改为弹出菜单**：Paperclip 按钮切换成弹出菜单（`ch-attach-menu`，沿用项目原生的 fixed-position 下拉模式，未引入 Radix Popover）。三项：
  - **上传文件** — 复用原 `<input type="file">` + `useFileUpload` 分片上传链路
  - **截屏** — `apps/web/src/lib/mediaCapture.ts::captureScreenshot`，走 `getDisplayMedia` → canvas 导出 `image/png`；用户点取消自动 fallback null
  - **摄像头拍照** — `CameraModal` 组件预览 + 拍照，共用同一 `addFilesToQueue` 入口
  - 能力探测：`isScreenCaptureSupported()` / `isCameraSupported()` 不支持时菜单项 disabled 并带 tooltip 说明

- [x] **三方登录（GitHub 优先）**：完整 OAuth 链路已落地。
  - 后端：`app/services/oauth_service.py` 编排 `state → exchange → profile → 关联或建号 → 签 JWT`；`app/api/v1/auth.py` 新增 `GET /auth/github`（302 到 authorize）和 `GET /auth/github/callback`（302 回前端并带 token）
  - 数据模型：`users.github_id` 唯一列 + `hashed_password` 改为可空（migration `f9a3b7c214e5`），OAuth-only 用户走「忘记密码」补设本地密码
  - 前端：`login/page.tsx` GitHub 按钮跳 `${API_BASE_URL}/auth/github`；新建 `app/(auth)/oauth/callback/page.tsx` 读取 token → `getMeWithToken` → `setAuth` → replace 到 `/chat`；`middleware.ts` 把 `/oauth` 加入公开路径
  - 集成测试：`tests/integration/test_oauth.py` 覆盖 authorize URL 生成、新用户创建、邮箱关联现有账户、state 校验、provider 错误透传、state 一次性消费 6 个场景
  - 配置文档：`docs-internal/oauth-setup.md` 记录 OAuth App 申请、环境变量、账号关联规则、扩展到 Google / Apple 的步骤
  - 微信 / Google / Apple 按钮统一显示为 disabled + tooltip「第三方登录即将开放」，待后续按同一模板扩展

- [ ] **Artifact 面板 → 更完整的代码预览**：当前 `apps/web/src/components/chat/ArtifactPanel.tsx` 已能对 HTML / CSS / JS 走 iframe `srcdoc` 沙箱运行（`buildRunSrcDoc` in `chat/utils.ts`，`sandbox="allow-scripts allow-forms"`），但语言覆盖窄、无框架支持、无错误反馈。需要扩展：
  - **React / Vue / Svelte 单文件预览**：识别 `jsx` / `tsx` / `vue` / `svelte` 代码块 → 在 iframe 内挂载 esm.sh 版本的运行时（`import React from 'https://esm.sh/react'`），在 `<div id="app">` 上渲染；仍走 srcdoc，不联网仅拉 esm.sh CDN
  - **Markdown 预览**：`isRunnableLang` 增加 `markdown` / `md` 分支，用 `marked` + 内置 CSS 直接渲染成静态 HTML 页
  - **Mermaid / 流程图**：识别 ` ```mermaid ` 代码块 → iframe 加载 `mermaid.esm.mjs`，调用 `mermaid.run()` 渲染 SVG
  - **JSON / CSV 表格预览**：`json` 走可折叠 tree 视图（自实现或用 `react-json-view` 但要避免 SSR），`csv` 走 `<table>` 展示
  - **运行时错误反馈**：iframe 内注入 `window.onerror` / `window.onunhandledrejection`，通过 `postMessage` 上抛到父页；面板底部新增一个可折叠的「控制台」面板显示错误 & `console.log/warn/error`（同样劫持后 postMessage）
  - **iframe 尺寸自适应 + 全屏切换**：面板顶部加「全屏」按钮，把 `.ch-artifact-panel` 切成 `position: fixed; inset: 0` 铺满窗口；iframe 保持 `100% × 100%`
  - **代码编辑（可选）**：view 模式下点击代码块可切编辑，改完点「重新运行」重放 srcdoc；用轻量 `codemirror-6` 或 `@codemirror/basic-setup`，避免引入 monaco（体积太大）
  - 对齐现有 CSS class 前缀 `ch-ap-*`；新增控制台面板走 `ch-ap-console-*`；所有第三方 CDN 依赖集中在 `apps/web/src/components/chat/artifact-runtimes.ts` 便于替换/自托管

## backend

- [ ] **引入 LangChain + LangGraph 作为 Agent 运行时**：当前 `backend/app/services/ai_service.py` 只做 provider 透传，`_generate_sse` 里预留的 `tool_call_start/delta/end` 事件从未被 emit——纯占位。要真正跑 Agent（tool-loop / planner-executor / checkpoint 恢复 / 多 agent 协作），需要在 service 层引入编排框架。选型：**LangChain 只作为 LLM/Tool 抽象层**（`ChatOpenAI(base_url=...)` 复用现有 OpenAI-compat 端点，Anthropic 走 `ChatAnthropic` 拿 `cache_control` / extended thinking），**LangGraph 作为 agent 图**（`StateGraph` + Postgres `AsyncPostgresSaver` checkpointer，天然支持中断/续跑/时间旅行）：
  - `pyproject.toml` 加 `langchain-core` / `langchain-openai` / `langchain-anthropic` / `langgraph` / `langgraph-checkpoint-postgres`；本地/CI 用 SQLite checkpointer 免依赖
  - 新增 `backend/app/services/agent_service.py`：定义 `AgentState`（messages / plan / tool*results / iteration），节点 `plan → call_model → dispatch_tool → observe → end`，`add_conditional_edges` 判断是否继续 tool-loop；用 `graph.astream_events(version='v2')` 把节点事件映射为现有 SSE 协议（`on_chat_model_stream` → `content_delta`，`on_tool_start/end` → `tool_call*\*`）——**前端 `useStream.ts` 协议保持不变\*\*
  - 新增 `backend/app/services/tools/` 目录 + `ToolRegistry`：每个 tool 一个文件（`web_search.py` / `code_exec.py` / `file_read.py` 等），用 LangChain `@tool` 装饰器暴露 schema；通过 `settings.enabled_tools` 白名单控制加载
  - `Message` 表加 `tool_calls: JSONB nullable`（历史消息回放 tool 结果）、`parent_message_id: UUID nullable`（同一轮 tool-round 内的中间产物归属主 assistant 消息），配套 alembic 迁移
  - 灰度路径：新增 `POST /api/v1/chat/agent/stream` 端点（同现有 `chat/stream` 请求体 + `enable_agent: bool`），走 LangGraph；老 `chat/stream` 保留为「纯对话」通道；前端 `sendMessage` 根据用户开关（settings 里加"启用 Agent"）选择目标端点；稳定后再合并
  - 观测：LangSmith 官方 SDK 一行接入（`LANGSMITH_TRACING=true` 环境变量），trace agent 每一步；生产可换 Langfuse（自托管 + OpenTelemetry）
  - 集成测试：`tests/integration/test_agent.py` 用 `AsyncSqliteSaver` 内存 checkpointer + mock LLM，跑通「用户问 → planner 拆 → 调 mock web_search → observe → 汇总回复」，断言 SSE 事件序列符合协议
  - 前置文档：项目根 `docs-internal/agent-architecture.md`（不受 `docs/` 只读约束）记录 state schema、tool 契约、checkpointer 数据模型、扩展新 tool 的步骤

- [ ] **实现真正的联网搜索功能**：作为上条 LangGraph agent 的第一个落地 tool。选型：**默认 Tavily**（专为 LLM 优化，返回 answer + 带 score 的 snippet 列表，单次查询成本低）；备选 SerpAPI（Google 结果最全、贵）、Bing Web Search（性价比中间、需 Azure）、Brave Search（隐私+便宜、结果覆盖略差）。需要：
  - `backend/app/services/tools/web_search.py`：LangChain `@tool` 定义，参数 `query: str, max_results: int = 5, search_depth: Literal['basic', 'advanced'] = 'basic'`；调用 `langchain-community` 的 `TavilySearchAPIWrapper`（或裸 httpx）
  - `settings.tavily_api_key` 环境变量；未配置时 `ToolRegistry` 跳过注册，模型看不到该 tool（避免"AI 说要调用但报没 key"）
  - Redis 缓存：查询结果 key=`websearch:{sha1(query)}` TTL 1 小时，控 API 成本；同 query 重复触发直接命中缓存
  - 速率限制：`fastapi-limiter` 或自实现，按 user_id 限制每分钟调用次数（默认 20/min），超限走 tool_call_end `status='error'`
  - SSE 事件：复用已有 `tool_call_start`（name=`web_search`, 参数 args_chunk）→ `tool_call_delta`（流式回填 args JSON）→ `tool_call_end`（`result_preview` 携带前 3 条标题+URL 摘要，完整结果落库 `Message.tool_calls`）
  - 前端 `ToolCallRow` 已能通用渲染，但需要 `web_search` 专属分支：把 result_preview 里的 sources 渲染成可点击链接列表（外链带 `target="_blank" rel="noopener"`），并在正文回答里给 AI 引用的 URL 加上 footnote 编号
  - 后端集成测试：mock TavilySearchAPIWrapper 返回固定 payload，端到端跑 `agent/stream` 断言 tool 事件序列 + 数据库 `Message.tool_calls` 落地正确
