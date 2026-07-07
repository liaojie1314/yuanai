# TODO — 未完成 / 待办

## Web

- [ ] **设置 → 外观与主题**：字体大小（`fontSize`）和界面密度（`density`）当前仅存偏好、未真正影响布局。需要：
  - `--user-font-size` CSS 变量传导到聊天区 / 侧栏 / 设置面板等文字节点（当前仅设在 `<html>` 但组件多用固定 `px`）
  - `data-density="compact|standard|loose"` 需驱动 padding / gap / min-height 变化（chat.css、settings.css、侧栏等目前未按 attr 切档）
  - 加一个可见的预览区（如设置面板顶部一段 sample 文本 + 一条 fake 消息），让用户即时看到效果

- [ ] **设置 → 通知设置**：前台浏览器通知（`new Notification()`）和 WebAudio 提示音已在 `ChatInterface.tsx` 实现，UI 开关偏好存 `localStorage`；但缺少后台推送能力（关闭标签/最小化浏览器时失效）。需要：
  - 注册 Service Worker（`public/sw.js`）；SW 监听 `push` 事件后调用 `self.registration.showNotification()`，这样在后台或浏览器最小化时仍能弹出系统通知
  - 后端新增 `/api/v1/notifications/subscribe`（接收 Web Push Subscription JSON 写入新表 `push_subscriptions`）和 `/unsubscribe` 端点；AI 流结束时服务端主动推送（替代现在在 `useStream.ts` stream complete 里的客户端检测）
  - 将 `ChatInterface.tsx` 中的 `playNotificationSound` 提取到独立工具文件，供 SW 的 `notificationclick` 事件复用
  - 短期可只做 SW + 系统通知，不做服务端推送（维持现有客户端检测逻辑），但需确保 HTTPS 环境下请求权限流程正常
  - 编写文档告诉怎么测试功能的实现

- [ ] **用户输入框 → 语音输入**：`ChatInterface.tsx:1274` 的 `Mic` 按钮已渲染但无 `onClick` 处理器，是纯占位 UI，无任何语音 API 调用。需要：
  - 使用 `window.SpeechRecognition ?? window.webkitSpeechRecognition`（Web Speech API）,根据实际企业项目的方案给出选择，是否可以添加端侧模型；不支持时（Firefox / 旧 Safari）隐藏按钮或显示 tooltip"当前浏览器不支持语音输入"
  - 点击 Mic 进入 `listening` 状态：按钮变红色脉冲动画，textarea placeholder 改为"正在聆听…"；检测到 `result.isFinal` 或用户再次点击时停止识别
  - 识别结果追加到 textarea 当前内容末尾（不覆盖已有文字）；`lang` 默认取 `navigator.language`（中文环境为 `zh-CN`）
  - 识别中途出错（`onerror`）时恢复按钮状态并 toast 提示错误原因

- [ ] **用户输入框 → 上传附件改为弹出菜单**：当前 `Paperclip` 按钮直接调用 `inputRef.current?.click()` 触发系统文件选择框，无中间弹层。需要：
  - 将 `Paperclip` 按钮替换为 `shadcn/ui Popover` 触发器，弹出包含三项的操作菜单：
    - **上传文件** — 保留现有 `<input type="file">` 逻辑（`useFileUpload` + 分片上传），附件进 `attachments` 队列不变
    - **截屏** — 调用 `navigator.mediaDevices.getDisplayMedia({ video: true })`，获取屏幕流后截一帧到 canvas 并导出为 `image/png` File，送入 `attachments` 同一队列；用户选定区域后自动关闭流
    - **摄像头拍照** — 调用 `getUserMedia({ video: true })`，在浮层内渲染 `<video>` 预览，点击"拍照"按钮后 canvas 捕获帧、关闭流、导出 File 并入队
  - 两项媒体功能均需 HTTPS 或 `localhost`；运行时检测 `navigator.mediaDevices` 能力，不支持时 disable 对应菜单项并显示 tooltip

- [ ] **三方登录**：登录页微信 / Google / Apple 按钮无 `onClick`，设置页绑定行全部 `disabled="第三方登录即将开放"`，后端 `auth.py` 无任何 OAuth 端点。优先接入 GitHub（流程最简、无商务审核；Google 次之、受众更广但需 GCP 项目；微信最复杂、需企业认证，可二期）：
  - 后端新增两个端点：`GET /api/v1/auth/github`（生成 `state` 写 Redis，返回 GitHub OAuth 授权 URL）和 `GET /api/v1/auth/github/callback`（exchange code → access_token → 获取 GitHub user email/id → 创建或关联账号 → 签发 JWT）；依赖 `httpx`，无需引入额外库
  - 前端 `login/page.tsx` 替换 GitHub 按钮的 `onClick`：`window.location.href = API_URL + '/api/v1/auth/github'`；新建 `app/(auth)/oauth/callback/page.tsx` 读取 URL 中 `?token=` 参数并写入 auth store，再跳转首页
  - 环境变量：后端需 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`，前端无需额外变量（回调由后端处理）
  - 在项目根新建 `docs-internal/oauth-setup.md`（不受 `docs/` 只读约束）记录 GitHub OAuth App 申请步骤、Callback URL 配置、所需环境变量，供其他开发者自助接入 Google / Apple 等额外 provider

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
