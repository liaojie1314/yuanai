# AGENTS.md — yuanai AI 代理协作指南

> 本文件供所有 AI 代理（Claude Code、Codex CLI 等）在进入本项目时阅读。  
> 请在执行任何任务前**完整阅读本文件**，并与 `CLAUDE.md` 配合使用。  
> `CLAUDE.md` 是项目入口和导航索引；本文件是 AI 代理的操作手册。

---

## 一、会话启动检查清单

每次新会话必须按顺序执行：

```
1. 读 CLAUDE.md（导航索引、开发铁律）
2. 读 AGENTS.md（本文件，操作规范）
3. 读 docs/master-plan.md（交付状态单一真源：做到哪了、还差什么）
4. 用 codebase-memory-mcp 加载知识图谱（见下节）
5. 确认当前任务所属 Phase，读对应 Phase 文档
6. 读 docs/dev-standards.md + docs/testing-standards.md
7. 读取 `.codex/runtime-toolchain.md`（本地文件存在时）；上下文压缩或恢复后，
   必须重新执行本清单再继续运行命令、测试、Git hook 或提交
8. 遇到非项目代码问题时，立即记录到 `.codex/environment-issues.md`，再继续排查或
   执行后续操作
```

**不得跳过步骤 1-4，不得以"已知项目"为由省略。**
全部项目文档统一在 `docs/` 下，入口是 [docs/README.md](docs/README.md)；
不存在 `docs-internal/` 等平行文档目录。
`.codex/runtime-toolchain.md` 是不提交的本地运行时记录，专门保存 Node.js/pnpm
版本冲突的根因和固定执行方式；它不能替代项目中的 `.nvmrc`、`.node-version`、`engines`
和 CI 版本声明。
所有不属于项目代码本身的环境问题（工具链、权限、网络、代理、数据库服务、浏览器、模拟器、
USB 真机连接等）都必须在 `.codex/environment-issues.md` 记录时间、症状、证据、
根因、影响和解决方式；该目录为本地执行记录，不进入 Git。

---

## 二、代码发现协议（Code Discovery Protocol）

### 优先使用 codebase-memory-mcp

在进行任何代码探索前，必须优先使用知识图谱工具，而非直接 grep/glob：

```bash
# 1. 确认项目已索引
codebase-memory-mcp cli list_projects '{}'

# 2. 加载架构决策记录（每次会话最先做）
codebase-memory-mcp cli manage_adr \
  '{"project": "home-liaojie1314-code-project-yuanai", "mode": "retrieve"}'

# 3. 查找函数/类/组件
codebase-memory-mcp cli search_graph \
  '{"project": "home-liaojie1314-code-project-yuanai", "name_pattern": ".*ChatInterface.*"}'

# 4. 追踪调用链
codebase-memory-mcp cli trace_path \
  '{"project": "home-liaojie1314-code-project-yuanai", "function_name": "stream_chat_endpoint", "direction": "both", "depth": 3}'

# 5. 检测 git diff 影响范围
codebase-memory-mcp cli detect_changes \
  '{"project": "home-liaojie1314-code-project-yuanai"}'
```

### 决策矩阵

| 问题类型           | 使用工具                                                |
| ------------------ | ------------------------------------------------------- |
| 找函数/类/组件定义 | `search_graph(name_pattern="...")`                      |
| 谁调用了 X？       | `trace_path(direction="inbound")`                       |
| X 调用了什么？     | `trace_path(direction="outbound")`                      |
| 查看函数源码       | `get_code_snippet(qualified_name=...)`                  |
| 文本内容搜索       | `search_code(pattern=...)` 或 Grep                      |
| 本次改动影响什么？ | `detect_changes()`                                      |
| 死代码/未使用函数  | `search_graph(max_degree=0, exclude_entry_points=true)` |

### 重新索引

当项目文件有大量变动后执行：

```bash
codebase-memory-mcp cli index_repository \
  '{"repo_path": "/home/liaojie1314/code/project/yuanai"}'
```

---

## 三、项目结构速查

```
yuanai/
├── apps/
│   ├── web/                # Next.js 15 App Router（当前主开发目标）
│   │   ├── src/app/        # 页面路由（App Router）
│   │   │   ├── (auth)/     # 认证页：login / register / forgot-password
│   │   │   └── (main)/     # 主功能页：chat / [conversationId]
│   │   ├── src/components/ # 组件
│   │   │   └── chat/       # 核心聊天组件（拆分自 ChatInterface）
│   │   ├── src/i18n/       # 国际化（next-intl）
│   │   ├── src/mocks/      # MSW handlers（开发/测试用）
│   │   ├── middleware.ts    # 认证守卫（Auth Guard）
│   │   └── tests/          # e2e/ + integration/ + mocks/
│   ├── mobile/             # Expo SDK 52+ React Native（Phase 3）
│   └── desktop/            # Electron 33+（Phase 4）
├── packages/
│   ├── core/               # @yuanai/core — 所有端共享业务逻辑
│   │   └── src/
│   │       ├── api/        # apiClient (axios + SSE，含 token 刷新拦截器)
│   │       ├── stores/     # Zustand stores: auth / chat / artifact
│   │       ├── hooks/      # useStream / useChatQueries 等
│   │       └── utils/      # 工具函数
│   ├── types/              # @yuanai/types — 前后端共享 TypeScript 类型
│   └── ui/                 # @yuanai/ui — Web + Desktop 共享 UI 组件
├── backend/                # FastAPI Python 后端
│   └── app/
│       ├── api/v1/         # 路由：auth.py / chat.py / files.py / models.py
│       ├── models/         # SQLAlchemy ORM：User / Conversation / Message / File
│       ├── schemas/        # Pydantic v2 请求/响应 Schema
│       ├── services/       # ai_service.py（AI 调用唯一入口）/ auth_service.py
│       └── core/           # config / database / redis / security
└── scripts/                # Node.js .mjs 跨平台脚本
```

### 关键文件速查

| 文件                                         | 职责                                    |
| -------------------------------------------- | --------------------------------------- |
| `apps/web/middleware.ts`                     | Next.js 认证守卫，拦截未登录请求        |
| `apps/web/src/components/ChatInterface.tsx`  | 主聊天界面（组装 chat/\* 子组件）       |
| `apps/web/src/components/chat/`              | MessageList / AIMessage / CodeBlock 等  |
| `packages/core/src/api/client.ts`            | axios 实例，含 401 → refresh 拦截器     |
| `packages/core/src/stores/auth.store.ts`     | 认证状态（用户信息、JWT token、记住我） |
| `packages/core/src/stores/chat.store.ts`     | 会话列表、活跃会话、流式消息状态        |
| `packages/core/src/stores/artifact.store.ts` | ArtifactPanel 开/关状态                 |
| `packages/core/src/hooks/useStream.ts`       | SSE 流式响应解析 Hook                   |
| `packages/core/src/hooks/useChatQueries.ts`  | TanStack Query hooks（会话/消息 CRUD）  |
| `packages/types/src/index.ts`                | 所有共享 TypeScript 类型                |
| `backend/app/services/ai_service.py`         | AI 调用统一入口（禁止绕过）             |
| `backend/app/api/v1/auth.py`                 | 认证路由                                |
| `backend/app/api/v1/chat.py`                 | 聊天路由（含 SSE 流）                   |
| `backend/tests/conftest.py`                  | pytest fixtures（DB / client / user）   |
| `scripts/_utils.mjs`                         | 跨平台脚本工具函数                      |

---

## 四、核心架构约束（不得违反）

### 1. AI 调用必须经 ai_service.py

```
❌ 前端直接调 OpenAI/Anthropic/DeepSeek API
✅ 前端 → POST /api/v1/chat/stream → backend ai_service.py → AI Provider
```

所有模型路由逻辑（provider 选择、API Key 管理、限流）集中在 `backend/app/services/ai_service.py`。

### 2. packages/ 禁止引入平台专用 API

```
❌ packages/core/ 中 import { useRouter } from 'next/navigation'
❌ packages/ui/ 中 import { View } from 'react-native'
✅ 平台专用逻辑放在 apps/ 对应子目录
```

### 3. 流式响应统一用 SSE + useStream Hook

```
后端: StreamingResponse（text/event-stream）
前端: packages/core/src/hooks/useStream.ts
禁止: WebSocket、轮询、前端直接 fetch stream
```

### 4. 单一数据源原则

- 后端是唯一真相源
- 前端通过 TanStack Query (`useChatQueries.ts`) 管理服务端缓存
- Zustand stores 仅存放客户端 UI 状态（流式中间态、主题、活跃会话 ID）

### 5. 路由层零业务逻辑

- `backend/app/api/v1/*.py` 路由函数只做：参数解析 → 调用 service → 返回响应
- 所有业务逻辑在 `services/` 层
- 数据库操作必须通过 async SQLAlchemy（禁止同步 Session）

---

## 五、TypeScript 编码规范

**完整规范见 [docs/dev-standards.md 一、TypeScript 规范](docs/dev-standards.md)**（强制规则、
命名约定、import 顺序、ESLint 配置），此处不重复维护。

只强调三条最容易违反的：

- **禁止 `any`**，用 `unknown` + 类型守卫替代；`object` 同样禁止
- 类型导入必须 `import type`，不得混入普通 import
- 所有 Promise 必须 `await` 或显式处理（`no-floating-promises`）

---

## 六、Python（后端）编码规范

**完整规范见 [docs/dev-standards.md 四、Python（后端）规范](docs/dev-standards.md)**
（Ruff + mypy 工具链、命名约定、强制规则），此处不重复维护。

只强调：全部公共函数需类型注解与中文 docstring；Pydantic v2 校验入参；
禁止在 API 层直接写 SQL，一律经 service 层。

---

## 七、测试规范（测试通过是进入下一功能的唯一许可证）

**完整规范与用例见 [docs/testing-standards.md](docs/testing-standards.md)**，此处只记门禁真相。

### 实际的门禁覆盖（重要）

不要假设 hook 会替你兜底：

| 时机         | 实际执行                                   | **没有**执行                                   |
| ------------ | ------------------------------------------ | ---------------------------------------------- |
| `git commit` | lint-staged（eslint --fix + prettier）     | tsc、任何测试                                  |
| `git push`   | `pnpm typecheck` + `pnpm test:unit`        | lint、format:check、后端 Ruff/mypy/pytest、E2E |
| CI           | Frontend quality / Web E2E smoke / Backend | —                                              |

`pnpm test:unit` **只跑前端**（turbo → vitest）。后端必须单独跑：

```bash
cd backend && PYTHONPATH="" uv run pytest tests/unit -q      # 需 PYTHONPATH="" 屏蔽 ROS2 污染
cd backend && PYTHONPATH="" uv run pytest tests/integration -q  # 需 docker compose up -d postgres
```

E2E 在本机需先 `npx playwright install chromium webkit`，且**必须清空 `ALL_PROXY`**
（socks 协议会让 Playwright 直接报 `Protocol "socks:" not supported`）：

```bash
ALL_PROXY= all_proxy= pnpm --filter @yuanai/web test:e2e
```

---

## 八、Git 工作流

**完整规范见 [docs/dev-standards.md 五、Git 工作流](docs/dev-standards.md) 与
[六、提交规范](docs/dev-standards.md)**，此处只记铁律。

- **主干是 `master`**，`dev` 为集成分支；改动走 `feature/*`、`fix/*` 分支，
  禁止直接在 `dev` / `master` 上开发
- `feature` → `dev` 用 `--no-ff`，**禁止 squash**（会压掉过程 commit）
- **push、合并 `dev`、合并 `master`、打 tag、触发发版：每次都必须当次征得用户同意**，
  禁止延续历史授权
- Commit message：Conventional Commits，**scope 只能取** `web` / `mobile` / `desktop` /
  `backend` / `ui` / `core` / `types` / `e2e` / `config`（脚本与工具类改动用 `config`）；
  禁止版本号前缀，禁止 `Co-Authored-By` trailer
- 禁止 `--no-verify`

---

## 九、开发环境命令速查

**启动、构建、清理一律走 `package.json` scripts**，不要手敲底层 CLI
（scripts 背后有端口清理、mock 开关、环境变量注入与运行时预检）。

完整命令见 [docs/dev-guide.md](docs/dev-guide.md) 与 [README.md 常用命令](README.md#常用命令)。
高频项：

```bash
pnpm dev:mock          # 仅前端，无需后端
pnpm dev:real          # 全栈（Docker + 迁移 + 后端 + Web）
pnpm dev:desktop       # Electron
pnpm dev:mobile        # Expo
pnpm clean             # 清理构建产物与工具缓存
pnpm clean:deep        # 额外清理 node_modules / .venv / Expo prebuild
pnpm typecheck && pnpm lint && pnpm test:unit
```

例外：后端的 `cd backend && uv run pytest|ruff|mypy|alembic` 是既定用法，不算绕过 scripts。
若某场景没有对应 script，**先加 script 再用**，并同步 [docs/dev-guide.md](docs/dev-guide.md)。

---

## 十、SSE 事件协议（前后端约定）

流式接口 `POST /api/v1/chat/stream` 返回的 SSE 事件格式：

```
# 消息开始
event: message_start
data: {"user_message_id":"uuid","assistant_message_id":"uuid","model":"gpt-4o"}

# 内容增量
event: content_delta
data: {"token":"RAG"}

# 思考过程（reasoning model）
event: thinking_delta
data: {"token":"我需要先分析..."}

# 工具调用开始
event: tool_call_start
data: {"id":"tc-1","name":"search","index":0}

# 工具调用参数增量
event: tool_call_delta
data: {"id":"tc-1","args_chunk":"{\"q\":"}

# 工具调用结束
event: tool_call_end
data: {"id":"tc-1","status":"done","result_preview":"..."}

# 消息结束
event: message_end
data: {"tokens_used":256,"finish_reason":"stop"}

# 错误
event: error
data: {"code":"MODEL_QUOTA_EXCEEDED","message":"模型调用额度不足"}

# 流结束
data: [DONE]
```

前端 `useStream` hook 按此协议解析，未知事件类型静默忽略（向后兼容）。

---

## 十一、API 关键路径速查

**认证** (`/api/v1/auth/`)

| 方法   | 路径              | 说明                | 需要认证 |
| ------ | ----------------- | ------------------- | -------- |
| POST   | /auth/register    | 注册，返回双 token  | 否       |
| POST   | /auth/login       | 登录，返回双 token  | 否       |
| POST   | /auth/refresh     | 刷新 access token   | 否       |
| POST   | /auth/logout      | 登出，吊销 refresh  | 是       |
| GET    | /auth/me          | 获取当前用户        | 是       |
| PATCH  | /auth/me          | 更新用户信息        | 是       |
| PATCH  | /auth/me/password | 修改密码            | 是       |
| DELETE | /auth/me          | 注销账号（CASCADE） | 是       |

**会话/聊天** (`/api/v1/chat/`)

| 方法   | 路径                             | 说明                     |
| ------ | -------------------------------- | ------------------------ |
| GET    | /chat/conversations              | 列表（cursor 分页）      |
| POST   | /chat/conversations              | 创建会话                 |
| PATCH  | /chat/conversations/:id          | 改标题/model/置顶        |
| DELETE | /chat/conversations/:id          | 删除（CASCADE 消息）     |
| GET    | /chat/conversations/:id/messages | 消息历史（cursor 分页）  |
| POST   | /chat/stream                     | SSE 流式对话（核心接口） |

**Token 有效期：** access 15 分钟（remember_me 时 7 天）| refresh 30 天

---

## 十二、常见陷阱与对策

### 前端

| 陷阱                                                                                    | 对策                                                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `useMessages` 查询键变化时 TanStack Query 先返回 `[]` 再加载，导致列表重复挂载/滚动抖动 | 等 `isLoading === false` 再渲染 `<MessageList>`；新建会话在 `onSuccess` 预播种 `['messages', id]` 为 `[]` |
| 虚拟列表 (`react-virtuoso`) 与 `key` 重置冲突                                           | `key={activeConv}` 强制重挂载，但只在数据已就绪时做，否则会在空数据上 remount                             |
| ArtifactPanel 条件挂载导致动画不触发                                                    | 始终挂载，用 `shown` state 保留最后 payload，`aria-hidden` 控制可见性                                     |
| CodeBlock 订阅整个 store 引起不必要重渲                                                 | 用 selector 只选需要的字段：`useArtifactStore(s => s.openView)`                                           |
| 语法高亮库"厨房水槽"打包                                                                | 用 `PrismAsyncLight`（按需加载语言），避免 Prism 全量 bundle 拖慢首屏                                     |

### 后端

| 陷阱                   | 对策                                                        |
| ---------------------- | ----------------------------------------------------------- |
| 直接在路由层写业务逻辑 | 路由只做参数解析 + 调 service                               |
| 同步数据库操作         | 必须 `async with session` + `await session.execute()`       |
| 裸 `except`            | Ruff 会报错；改为 `except SpecificError as e:`              |
| AI 超时无设置          | `ai_service.py` 所有调用必须有 `timeout=60` 和最多 2 次重试 |
| N+1 查询               | `joinedload` 或 `selectinload` 预加载关联数据               |

### Git

| 陷阱                       | 对策                                           |
| -------------------------- | ---------------------------------------------- |
| 多关注点积累在一次 commit  | 按逻辑关注点拆分，再统一 push                  |
| 大改动后 diff 超出会话记忆 | `git diff HEAD` 实际 diff 为准，不依赖会话记忆 |
| `--no-verify` 跳过 hook    | 禁止；紧急情况须在 PR 说明原因                 |

---

## 十三、当前阶段状态

**交付状态的唯一真源是 [docs/master-plan.md](docs/master-plan.md)**，本文件不再维护阶段状态表
（此前这里的表格长期停留在 2026-08-13，把 Phase 4 写成前沿，而 Phase 5/6/7 其实都已落地）。

开工前先读 master-plan 确认「做到哪了、还差什么」。

---

## 十四、文档维护

用户已于 2026-08-15 明确授权执行会话维护 `docs/`。实现新功能或修复重要问题时，
应同步更新相关使用说明、排障记录或实施计划；不得在未实现对应行为时宣称已经交付。
Phase 规格的产品范围变更仍须由用户明确决定。

---

## 十五、用户工作流约束

### 持久工作流约束

- 涉及技术选型、功能范围、平台策略或新依赖时，先列出选项、推荐项和取舍，由用户拍板后再实现。
- 修复 bug 或处理遗留问题时，先在可用的真机、模拟器或本地运行环境复现并保留日志/截图证据，再阅读代码定位。
- 每完成一个独立功能必须运行对应测试并创建本地 commit，然后继续后续功能；未经用户明确允许，不得 push、合并到 `dev` 或合并到 `master`。
- `.codex/` 仅用于本地计划与执行记录，禁止纳入 commit。
- 项目启动、构建和桌面安装包生成必须调用对应 `package.json` script，禁止绕过 script 直接调用底层 CLI。
- 及时清理本次启动、测试、构建或模型下载产生的临时缓存；清理前先确认路径和归属，不删除用户数据、项目依赖缓存或仍在使用的模型缓存。
- `docker-compose*.yml` / `docker-compose*.yaml` 中所有镜像必须使用明确版本，禁止 `latest`、仅 major 版本等浮动标签。

_本文件由 AI 代理生成并维护。如项目规范有变更，请同步更新本文件。_
