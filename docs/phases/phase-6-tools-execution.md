# Phase 6 - 工具系统、MCP、云端沙箱与桌面执行节点

- **前置条件**：Phase 5 Agent Run、审批暂停/恢复、事件重放和租户隔离全部通过
- **桌面依赖**：云端工具可先实现；桌面执行节点依赖 Phase 4 Electron 的主进程、安全存储和自动更新
- **建议分支**：`feature/tools-execution`
- **执行范围**：按 Wave 分批修改 `backend/`、`packages/types/`、`packages/core/`、`apps/web/`、`apps/desktop/`；Mobile 仅保持共享协议兼容，不实现本阶段的工具控制中心或本地执行节点。
- **阶段定位**：让 Agent 从“会规划”升级为“能在受控边界内执行真实数字动作”

> **当前实现状态（2026-08-30）**：本页是 Phase 6 的目标合同和六个 Wave 的实施路线。
> 当前 checkout 已在 `feature/tools-execution` 分支本地提交 Wave 1-5 的实现代码：Tool
> Runtime 安全基础、云端只读/产出工具与受限 Python 沙箱、远程 Streamable HTTP MCP、
> Desktop 执行节点协议与 Electron 客户端、Web Tool Control Center。**本页验收标准尚未
> 达成**：桌面客户端真实配对/执行演练、故障注入稳定性、安全测试和下文标注的边界项
> （stdio MCP、真实 DOM 浏览器自动化、SecretStore 持久化契约）仍未完成，进入 Phase 7
> 的许可证仍然阻塞。勾选任何验收项前必须有代码、测试和真实运行证据。

| Wave                      | 当前状态                                   | 进入 Phase 7 的影响 |
| ------------------------- | ------------------------------------------ | ------------------- |
| 1. 共享契约与安全基础     | 代码已提交，契约测试通过                   | 阻塞                |
| 2. 云端只读与产出工具     | 代码已提交，模拟链路测试通过               | 阻塞                |
| 3. MCP 连接与路由         | 仅远程 HTTP MCP；stdio 未实现              | 阻塞                |
| 4. Desktop 执行节点       | 后端协议已过真实链路演练；客户端待真实验收 | 阻塞                |
| 5. Web 控制中心           | 页面/hooks/测试已提交；真实数据验收未做    | 阻塞                |
| 6. 浏览器自动化与安全灰度 | 未开始（仅受限静态 HTML 抓取）             | 阻塞                |

---

## 1. 阶段目标

1. 建立统一、可扩展、可审计的 Tool Runtime
2. 支持内置工具、远程 MCP、云端沙箱和桌面本机工具
3. 建立工具风险分级、作用域授权、凭证隔离和参数级审批
4. 支持工具进度流、结构化结果、Artifact 和大结果外置存储
5. 支持桌面执行节点断线、重连、版本升级、任务取消和结果签名
6. 交付首批通用工具：Web、文件、代码、知识提取和基础浏览器操作

### 1.1 非目标

- 不允许在 FastAPI Web 进程中直接执行 Shell 或用户代码
- 不允许模型自行安装任意 MCP、二进制或依赖
- 不默认开放用户整个磁盘、浏览器 Cookie、SSH Key 或环境变量
- 不实现无人确认的付款、转账、账号删除和公开发布
- 不用截图坐标点击作为首选桌面控制方式；优先 API、DOM、无障碍树和原生 IPC

---

## 2. 执行平面

```text
                        RunCoordinator
                              |
                       ToolRouter + Policy
                    /            |             \
                   v             v              v
          Cloud Tool Worker   MCP Gateway   Desktop Node Gateway
                   |             |              |
          Rootless Sandbox   HTTP/stdio*    Electron Main Process
                   |             |              |
          Web/File/Code       External       Local File/App/
          Browser Worker      Services       Browser/OS Tools

* stdio MCP 只能运行在隔离 Worker 或已配对桌面节点，不能运行在 API 进程
```

工具的“定义”“授权”“调度”“执行”必须分离：

- ToolRegistry：代码级能力目录和 schema
- ToolConnection：用户连接的账号或 MCP Server
- PolicyEngine：判断是否允许、是否审批、允许在哪执行
- ToolRouter：按数据位置、节点能力、延迟和策略选择执行位置
- ToolExecutor：具体执行，不参与产品授权判断

### 2.1 平台边界

- Backend 保存 ToolRegistry、Policy、审批、执行、Artifact 和审计事实，并负责调度云端 Worker。
- Web 提供工具目录、连接管理、审批、执行时间线和 Artifact 控制中心。
- Desktop 是受配对和签名保护的本地执行节点，负责本机资源授权、任务接收和结果回传，不重复实现完整 Web 控制中心。
- Mobile 继续支持普通聊天和共享 Agent 协议；本阶段不实现 MCP 管理、工具控制中心、Desktop Node 或任意本地工具执行。

---

## 3. 工具契约

### 3.1 `ToolSpec`

在 Phase 5 契约上补齐：

```python
class ToolSpec(BaseModel):
    name: str
    version: str
    description: str
    input_schema: dict[str, object]
    output_schema: dict[str, object] | None
    risk_level: ToolRisk
    side_effect: SideEffect
    execution_locations: set[ExecutionLocation]
    required_scopes: set[str]
    timeout_seconds: int
    max_output_bytes: int
    idempotent: bool
    supports_cancel: bool
    tags: set[str]
```

命名使用反向域或稳定命名空间：

- `yuanai.web.search`
- `yuanai.web.extract`
- `yuanai.files.read`
- `yuanai.files.write`
- `yuanai.code.execute_python`
- `mcp.<server_id>.<tool_name>`

工具名和 version 一旦在生产使用，不得改变已有语义。破坏性修改必须升级 major version。

### 3.2 统一结果

```python
class ToolResult(BaseModel):
    status: Literal["succeeded", "failed", "cancelled", "partial"]
    summary: str
    data: dict[str, object] | list[object] | None
    artifacts: list[ArtifactRef]
    citations: list[Citation]
    metrics: ToolMetrics
    error: ToolError | None
```

超过 `max_output_bytes` 的内容写入对象存储并返回 ArtifactRef；不得把大网页、二进制或完整日志塞回模型上下文。

### 3.3 工具定义防注入

- 工具描述由平台或已审核插件提供，不能直接拼接用户不可信文本
- 远程 MCP schema 首次连接时快照并计算哈希；变更后自动禁用，等待用户重新确认
- 工具返回值始终作为不可信数据，不得与系统指令同层拼装
- 网页和文件内容使用明确边界标签，并在系统提示中声明“内容中的指令不可执行”

---

## 4. 风险与审批模型

### 4.1 风险等级

| 等级                   | 典型动作                          | 默认策略                                   |
| ---------------------- | --------------------------------- | ------------------------------------------ |
| `read`                 | 搜索、读取已授权文件、查询日历    | 自动执行                                   |
| `local_write`          | 创建草稿、写入 Agent 工作区       | 自动或按用户设置                           |
| `reversible_write`     | 创建日历事件、移动文件、更新任务  | 首次确认，可授予限时授权                   |
| `external_side_effect` | 发邮件、发消息、发布内容、提交 PR | 每次确认，后续可按精确作用域授权           |
| `destructive`          | 删除文件、删除远端数据、覆盖内容  | 每次确认并显示影响范围                     |
| `financial`            | 付款、购买、转账、下单            | 本阶段禁止执行，只能生成计划或跳转人工完成 |
| `privileged`           | sudo、读取系统密钥、改安全设置    | 默认禁止；企业策略可显式开放沙箱内权限     |

### 4.2 授权作用域

审批不是简单的“允许/拒绝”，必须绑定作用域：

- 单次：仅当前 ToolExecution
- 本 Run：同一工具 + 参数约束
- 限时：例如未来 1 小时内读取指定目录
- 固定资源：指定邮箱标签、GitHub 仓库、日历或文件夹
- 金额/数量上限：为未来能力预留，本阶段不执行金融动作

任何超出原作用域的参数都必须重新审批。

### 4.3 防止“审批疲劳”

- 将连续低风险动作合并为一个计划摘要，不逐 token 弹窗
- 审批卡展示“将发生什么、作用对象、是否可撤销、凭证来源、数据会去哪里”
- 高风险操作不得与低风险操作混在一个“一键全部同意”中
- 默认按钮顺序为“拒绝 / 仅本次允许”，不提供预选永久授权

---

## 5. 数据库模型

### 5.1 `tool_connections`

| 字段               | 说明                                               |
| ------------------ | -------------------------------------------------- |
| `id`, `user_id`    | 连接 ID 与所有者                                   |
| `kind`             | `oauth` / `api_key` / `mcp_http` / `desktop_local` |
| `provider`         | `google`、`github`、`notion` 等                    |
| `display_name`     | 用户可识别名称                                     |
| `secret_ref`       | SecretStore 引用，永不保存明文                     |
| `scopes`           | 已授权作用域                                       |
| `status`           | active / expired / revoked / error                 |
| `metadata`         | 非敏感账号信息                                     |
| `last_verified_at` | 最近健康检查                                       |

### 5.2 `tool_executions`

| 字段                             | 说明                                              |
| -------------------------------- | ------------------------------------------------- |
| `id`, `run_id`, `step_id`        | 执行标识                                          |
| `tool_name`, `tool_version`      | 稳定工具版本                                      |
| `connection_id`                  | 使用的用户连接，可空                              |
| `execution_location`             | cloud / desktop / mcp_remote                      |
| `node_id`                        | 桌面或云沙箱节点，可空                            |
| `risk_level`, `side_effect`      | 执行时快照                                        |
| `arguments_encrypted`            | 敏感参数加密存储；普通参数也必须脱敏              |
| `arguments_hash`                 | 审批和幂等校验                                    |
| `idempotency_key`                | 防重复副作用                                      |
| `status`                         | queued/running/waiting/succeeded/failed/cancelled |
| `result_summary`, `artifact_ids` | 结果引用                                          |
| `started_at`, `finished_at`      | 时间                                              |

### 5.3 `execution_nodes`

| 字段                              | 说明                                   |
| --------------------------------- | -------------------------------------- |
| `id`, `user_id`                   | 节点与所属用户                         |
| `name`, `platform`, `app_version` | 设备信息                               |
| `public_key`                      | 设备签名公钥                           |
| `capabilities`                    | 工具、OS、浏览器等能力列表             |
| `status`                          | online/offline/revoked/update_required |
| `last_seen_at`                    | 心跳                                   |
| `policy`                          | 设备端允许的目录和工具策略             |

### 5.4 `resource_grants`

用于本地文件、目录、浏览器 Profile 或具体应用的细粒度授权。保存稳定资源 ID 和显示名称，不默认上传真实路径；真实路径可仅保存在桌面节点本地。

---

## 6. SecretStore

统一接口：

```python
class SecretStore(Protocol):
    async def put(self, owner_id: UUID, value: SecretValue) -> SecretRef: ...
    async def get(self, owner_id: UUID, ref: SecretRef) -> SecretValue: ...
    async def delete(self, owner_id: UUID, ref: SecretRef) -> None: ...
```

实现策略：

- 开发/自托管：AES-256-GCM 加密后存 PostgreSQL，master key 仅来自环境变量或 Docker Secret
- 云端生产：AWS KMS、GCP KMS、Azure Key Vault 或 HashiCorp Vault adapter
- 桌面凭证：Electron `safeStorage` / OS Keychain；云端只保存连接存在与作用域，不保存明文
- 日志、Event、trace 和异常禁止输出 secret；健康检查只返回 `valid/invalid`

**当前实现边界（2026-08-31）**：`DatabaseSecretStore` 已实现 `put/get/delete`，使用独立
的 `SECRET_STORE_ENCRYPTION_KEY` 经 AES-256-GCM 加密后保存到 PostgreSQL；缺少主密钥时
fail closed，不回退到 JWT 或节点加密密钥。`db://` 引用强制内嵌租户身份，跨租户引用在
校验和读取时都会被拒绝。`EnvironmentSecretStore` 继续兼容只读的
`env://YUANAI_MCP_SECRET_<去掉连字符的大写用户UUID>_<NAME>` 引用，数据库与环境引用由
`TenantSecretStore` 路由；环境变量仍由部署管理，应用不会删除它。云端 KMS adapter 待补。

每个连接器必须声明数据处理位置：cloud、desktop 或 user_selected。

---

## 7. 云端沙箱

### 7.1 基线

- 每次 Run 或 Workspace 使用独立 rootless 容器
- 非 root 用户、只读基础镜像、临时可写工作目录
- CPU、内存、PID、磁盘、执行时长和输出大小限制
- 默认无网络；需联网工具通过受控 egress proxy 和域名策略
- 不挂载 Docker socket、宿主 Home、服务端 `.env` 或数据库凭证
- 依赖安装使用允许列表、锁文件和缓存镜像；禁止模型任意 `curl | sh`
- 完成后生成 Artifact，容器按保留策略销毁

### 7.2 首版执行镜像

- `yuanai-python`：Python 3.12，常用数据/文档库，禁用系统包安装
- `yuanai-node`：Node LTS，用于受控脚本和前端构建
- `yuanai-browser`：Playwright Chromium，由专用 Browser Worker 管理

工具调用与沙箱内部进程通过结构化 RPC 通信，不解析自然语言日志判断成功。

### 7.3 Egress 控制

- DNS 解析后阻断 loopback、link-local、RFC1918、云元数据地址和用户内网
- 对重定向后的每一跳重复做 SSRF 校验
- 默认只允许 80/443；禁止任意 TCP 和 UDP
- 下载文件执行 MIME、大小、哈希和恶意软件扫描
- 浏览器 Cookie 与 API 凭证按域隔离，不进入代码沙箱

---

## 8. MCP 支持

### 8.1 支持范围

- 远程 Streamable HTTP MCP：云端和桌面均可连接（**当前已实现**）
- stdio MCP：仅云端隔离 Worker或桌面节点运行（**尚未实现**，是 Wave 3 剩余范围）
- 每用户/Workspace 独立配置，不提供全局共享用户凭证
- 首次连接展示服务器来源、工具列表、schema、网络目标和环境变量需求

### 8.2 生命周期

1. 用户添加 MCP Server
2. 服务端或桌面节点执行 discovery
3. 保存工具 schema 快照、server fingerprint 和权限需求
4. 用户启用指定工具，而不是默认启用全部
5. 每次调用仍经过 yuanai PolicyEngine 和审计
6. schema、证书、域名或启动命令发生变化时自动暂停

MCP 工具不能绕过审批，也不能直接获得其他 ToolConnection 的 SecretRef。

---

## 9. 桌面执行节点

### 9.1 架构

```text
Electron Main Process
├── node identity + safeStorage
├── outbound WSS client
├── local ToolRegistry
├── resource grants
├── approval bridge
├── job executor
└── audit spool（离线暂存）

Renderer
├── 节点状态
├── 本机授权管理
├── 本地审批
└── 当前执行任务与取消
```

所有本机执行必须在 Electron main/preload 的白名单 IPC 内完成；Renderer 不获得 Node 全权限。

### 9.2 配对

1. 用户在已登录客户端创建一次性配对码（Web 控制中心或 Desktop 设置页均可发起）
2. Desktop 生成 Ed25519 密钥对，私钥进入 safeStorage
3. 配对码换取短期注册 token，服务端保存设备公钥
4. 后续 WSS 连接使用设备 JWT + challenge 签名；令牌到期前可用登记私钥
   签署旧令牌调用 `POST /execution-nodes/token` 续期，撤销节点后旧令牌立即失效
5. 用户可在任一端撤销节点；撤销后旧密钥立即失效

### 9.3 Job 协议

- 服务端发送：`job_offer`，包含 execution ID、工具、参数摘要、策略、过期时间和签名
- 节点回复：`accepted` / `rejected` / `approval_required`
- 运行中：`progress`、`artifact_chunk`、`heartbeat`
- 终态：`completed` / `failed` / `cancelled`，结果由设备签名
- 服务端必须确认 ACK；节点在 ACK 前保留加密结果，重连可重发

### 9.4 首批本地工具

- 读取用户显式选择的文件和目录
- 在 Agent 工作区内创建/修改文件
- 使用系统默认浏览器打开 URL
- 获取剪贴板内容，仅在用户主动触发且每次确认
- 通过 Electron 原生文件选择器授予新 ResourceGrant

任意桌面软件控制和带登录态的浏览器 Profile 自动化在本阶段后半段灰度，不作为进入 Phase 7
的硬门槛。浏览器 Worker 的 DOM/无障碍树读取与受控动作属于 Wave 6，仍是其安全验收和
Phase 7 许可证的一部分。

---

## 10. 首批云端工具

### 云端只读与产出（Wave 2）

- Web 搜索：provider adapter，返回结构化结果和引用
- 网页提取：正文、元数据、链接和抓取时间
- 上传文件读取：PDF、Office、文本、图片 OCR 的统一解析入口
- Python 代码执行：隔离沙箱，返回 stdout、文件和图表 Artifact
- 工作区文件生成：Markdown、CSV、JSON、DOCX、XLSX、PPTX

### 受控浏览器（Wave 6）

- 打开页面、读取 DOM/无障碍树、点击、输入、下载、截图
- 优先使用语义定位器，不使用固定坐标
- 登录态存储在独立加密 Browser Profile
- 每个导航和下载经过域名与 SSRF 策略
- CAPTCHA、二次验证和异常风控自动转为人工接管

> **当前边界（2026-08-30）**：现存的 `web_extract` / `browser_open` / `browser_click`
> 是 HTTPS 公网受限抓取：SSRF 逐跳校验、DNS 固定、100KB 截断、静态 HTML 文本与前 100
> 个链接的解析，`browser_click` 只按可见文本重新抓取目标页。**没有** JS 渲染、无障碍
> 树、坐标点击、表单提交、Cookie、下载或截图能力，不得当作浏览器自动化使用。真实 DOM
> 浏览器 Worker 属于 Wave 6 未开工范围。

---

## 11. Artifact 模型

新增统一 `artifacts`：

- `id`, `user_id`, `run_id`, `tool_execution_id`
- `kind`：document / spreadsheet / image / code / archive / browser_snapshot / log
- `name`, `mime_type`, `size_bytes`, `storage_key`, `sha256`
- `sensitivity`, `retention_policy`, `expires_at`
- `preview_json`、`created_at`

Artifact 下载使用短期签名 URL；用户 A 不能通过猜测 storage key 访问用户 B 内容。浏览器截图和工具日志默认短期保留。

---

## 12. API 与 UI

### 12.1 API

- `/tools/catalog`：当前用户可用工具和风险信息
- `/tool-connections`：连接创建、状态、作用域、撤销
- `/mcp-servers`：添加、发现、测试、启停
- `/execution-nodes`：配对、列表、能力、撤销
- `/resource-grants`：本地资源授权元数据
- `/tool-executions/{id}`：执行快照、取消和 Artifact
- `/artifacts/{id}`：详情、预览、下载和删除

### 12.2 用户控制中心

- 工具目录：来源、能力、执行位置、风险、所需连接
- 连接管理：账号、作用域、健康状态和最后使用时间
- MCP：Server 来源、工具列表、schema 变化和测试结果
- 设备：在线状态、版本、能力、资源授权和撤销
- 安全：授权历史、限时授权和“一键撤销全部”

### 12.3 Agent 执行界面

- 工具卡明确显示“云端执行”或“在 XXX 电脑执行”
- 浏览器工具展示当前域名和操作摘要
- 代码执行展示资源限制、日志和输出 Artifact
- 本机节点离线时允许用户选择等待、改用云端或取消

---

## 13. 测试要求

### 13.1 契约测试

每个工具必须通过同一套 Tool Contract Suite：schema、超时、取消、最大输出、脱敏、幂等、错误码和 Artifact。

### 13.2 安全集成测试

- Prompt injection 不能让网页内容调用未授权工具
- MCP schema 变化会自动禁用连接
- SSRF 阻断 localhost、内网、metadata endpoint 和重定向绕过
- 沙箱无法读取宿主环境变量、Docker socket 和其他用户工作区
- 审批后参数被替换会拒绝执行
- 重试不会重复创建外部副作用
- 用户 A 无法使用用户 B 的连接、节点、授权或 Artifact

### 13.3 桌面 E2E

- 配对 -> 心跳 -> 接收任务 -> 本地审批 -> 完成 -> 结果 ACK
- 节点断线重连后不丢任务、不重复执行
- safeStorage 不可用时拒绝持久化敏感凭证
- 节点撤销后 WSS 和未执行 Job 立即失效
- Desktop 版本低于最小协议版本时进入 `update_required`

---

## 14. 分 Wave 交付顺序

每个 Wave 都必须有独立的后端契约、前端行为、测试和本地 Conventional Commit；通过该 Wave 的入口/出口条件后才能进入下一 Wave。

### Wave 1：共享契约与安全基础

- 实现 ToolSpec、ToolResult、ToolExecution、Artifact、PolicyEngine、SecretStore 和 ToolConnection。
- 入口：Phase 5 Run、审批暂停/恢复、事件重放和租户隔离测试通过。
- 出口：schema、风险/作用域、脱敏、幂等、取消和 Artifact 契约测试通过。

### Wave 2：云端只读与产出工具

- 实现 Web 搜索、网页提取、上传文件解析、隔离 Python 执行和工作区文件生成。
- 云端代码只能在 rootless Worker 中运行，不能进入 FastAPI 请求进程。
- 出口：完成一条“搜索 -> 提取 -> 分析 -> 报告 Artifact”链路，且沙箱隔离测试通过。

### Wave 3：MCP 连接与路由

- 实现远程 HTTP MCP、隔离 Worker/配对节点中的 stdio MCP、schema 快照和 ToolRouter。
- `DatabaseSecretStore` 的租户绑定加密持久化契约已完成；stdio MCP 隔离执行仍未实现。
- 首次连接只启用用户明确选择的工具；schema、证书、域名或启动命令变化时自动暂停。
- 出口：MCP schema 变化、凭证隔离、审批和跨租户测试通过。

### Wave 4：Desktop 执行节点

- 实现配对、safeStorage 密钥、WSS 心跳、Job ACK、断线恢复、取消、节点撤销和资源授权。
- 首批本地能力限于用户显式选择的文件/目录、Agent 工作区文件和系统默认浏览器打开 URL。
- 出口：配对 -> 审批 -> 执行 -> 签名结果 -> ACK，以及断线恢复和旧节点失效 E2E 通过。

### Wave 5：Web 控制中心

- 实现工具目录、连接/MCP/节点管理、审批卡、执行时间线和 Artifact 预览下载。
- 控制中心只呈现 Backend 的事实，不在前端复制策略判断。
- 出口：Web 核心 Agent 工具链和节点执行链 E2E 通过。

### Wave 6：浏览器自动化与安全灰度

- 实现 DOM/无障碍树优先的浏览器动作、域名/SSRF/下载策略、人工接管和故障注入。
- 坐标点击、CAPTCHA 绕过和无人确认的高风险副作用不作为本阶段默认能力。
- 出口：安全测试无高危问题，纯云端链路和云端编排 + Desktop 执行链在故障注入下稳定通过。

---

## 15. 验收标准

- [ ] Agent 能完成“搜索资料 -> 提取网页 -> 运行分析代码 -> 生成报告 Artifact”的完整任务
- [ ] 所有工具执行均有 Run、Step、Execution 和审计记录
- [ ] 外部副作用模拟工具未经批准绝不执行
- [ ] 云沙箱无法访问宿主或其他租户数据
- [ ] MCP Server 只能暴露用户明确启用的工具
- [ ] Desktop Node 可安全配对、撤销、断线恢复和取消任务
- [ ] 本地文件只有经过系统选择器授权后才可读取
- [ ] 大结果通过 Artifact 返回，不撑爆模型上下文和 SSE
- [ ] Tool Contract Suite、安全集成测试和 Desktop E2E 全部通过

**进入 Phase 7 的许可证**：Wave 1-6 的出口条件全部满足，至少一条纯云端多工具链和一条云端编排 + 桌面执行链在故障注入下稳定通过，且安全测试无高危问题。

### 当前证据索引（2026-08-30）

| 验收域                                                                       | 证据                                                                                                              | 状态                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Tool 契约、schema 边界、脱敏与幂等                                           | `backend/tests/unit/test_tool_registry.py`、`test_tool_runtime_security.py`、`test_desktop_tools.py`              | 已覆盖                               |
| 云端多工具链（搜索→提取→分析→Artifact）                                      | `backend/tests/integration/test_cloud_tool_chain.py`（模拟模型/搜索/抓取）                                        | 模拟已覆盖；真实外部模型链未验证     |
| 沙箱 fail closed 与隔离                                                      | `backend/tests/unit/test_tool_runtime_security.py`、`3dbf480`                                                     | 已覆盖                               |
| MCP 连接绑定、审批与跨租户隔离                                               | `backend/tests/integration/test_mcp_runtime.py`                                                                   | 已覆盖                               |
| Desktop 节点协议（配对→challenge→任务→签名→ACK→续期→取消→重连重放→撤销失效） | `backend/tests/unit/test_execution_node_protocol.py`；真实后端 12 步链路演练（2026-08-30，含真实 WSS 与签名验证） | 已覆盖（后端链路）                   |
| Desktop Electron 客户端（safeStorage、白名单 IPC、本地审批、任务执行）       | `apps/desktop/src/main/execution-node/*` 单元测试 81 例、`ExecutionNodeSection` 组件测试                          | 组件级已覆盖；真实桌面端到端验收未做 |
| Web Tool Control Center                                                      | `apps/web/src/components/agent/ToolControlCenter.tsx` + 组件测试 8 例                                             | 组件级已覆盖；真实数据验收未做       |
| 故障注入（Worker 崩溃、5 分钟断线、重连风暴）                                | 尚未执行                                                                                                          | 未验证                               |
| 安全测试（Prompt injection、审批后参数替换、重试幂等）                       | 部分：审批哈希绑定与幂等键有测试；其余未系统执行                                                                  | 部分覆盖                             |

因此，Phase 6 许可证仍然阻塞：剩余工作为 Desktop 客户端真实端到端验收、故障注入演练、
系统性安全测试与 Wave 6 浏览器能力。
