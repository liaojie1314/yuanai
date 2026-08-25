# Phase 5 - Agent 运行时与任务状态机

- **前置条件**：Phase 1 后端与 Phase 2 Web 已完成；Phase 3 Mobile 可并行；不依赖 Phase 4 Desktop 完成
- **建议分支**：`feat/phase-5-agent-runtime`
- **执行范围**：`backend/`、`packages/types/`、`packages/core/`、`apps/web/`；Mobile/Desktop 本阶段只保持协议兼容
- **阶段定位**：在不破坏现有聊天功能的前提下，建立可持久化、可恢复、可审批的 Agent 最小闭环

> **当前验收状态（2026-08-25）**：当前 checkout 已包含 Phase 5 Runtime 的实现、迁移、
> Worker、Web Agent UI 和测试。逐项实现契约记录见
> [Phase 5 实施清单](./phase-5-agent-runtime-implementation-todo.md)。本页的验收复选框
> 只有在对应测试或真实运行证据明确存在时才勾选；不能用构建成功替代恢复、审批或租户隔离证据。

---

## 1. 已确认的产品与技术决策

| 编号 | 决策         | 结论                                                                                     |
| ---- | ------------ | ---------------------------------------------------------------------------------------- |
| D1   | 产品定位     | 面向所有用户的通用个人数字助理，覆盖日常生活、学习与工作；OPC 是高阶专业场景而非唯一受众 |
| D2   | 最终能力边界 | 可通过 API、浏览器、文件、代码或桌面软件完成的任务；线下人工动作暂不覆盖                 |
| D3   | 部署模式     | 混合模式：云端编排与持续任务 + 桌面端本机执行节点                                        |
| D4   | 数据策略     | 分级存储：普通任务可云端保存；敏感文件、凭证和私密记忆支持本地保留                       |
| D5   | 自主策略     | 风险分级审批：读取默认自动，外部副作用和高风险动作必须确认                               |
| D6   | 首版范围     | 先建立跨生活与工作的通用数字能力，再扩展个人场景包、职业场景包和 OPC 经营工作流          |
| D7   | 开源策略     | 不 fork Hermes 产品；自建 yuanai Agent 内核，选择性复用成熟协议、组件与 MIT 代码         |
| D8   | 后台策略     | 同时建设用户控制中心与最小运营后台，完整治理在 Phase 8 完成                              |

### 1.1 为什么不直接 fork Hermes Agent

Hermes 是重要参考实现，但其主形态是单机安装、CLI/Gateway、SQLite/FTS5、配置文件和本机密钥。yuanai 已经是 FastAPI + PostgreSQL + Redis 的多用户、多端、API-first 产品。直接 fork 会产生双账户、双会话、双记忆和双配置系统，并长期承担上游合并成本。

本项目可以借鉴或选择性移植以下设计，但必须通过 yuanai 自己的领域接口隔离：

- Agent loop、工具注册表、Skills、MCP、审批与执行后端抽象
- 定时任务、消息渠道、子 Agent、执行轨迹与管理后台的信息架构
- MIT 代码复用必须保留版权与许可证说明，并记录来源 commit

### 1.2 为什么首版不采用 LangGraph/Temporal 作为领域核心

首版采用“自有状态机 + PostgreSQL 真相源 + Redis 异步队列”的窄内核：

- Agent 的 Run、Step、Event、Approval 必须属于 yuanai 领域模型，不能只存在于第三方 checkpointer
- 当前调用链简单，自建有界工具循环可控且更容易与现有 `ai_service.py`、SSE 和消息表兼容
- 所有队列和编排能力通过接口隔离；当出现跨小时工作流、复杂补偿事务或多集群需求时，再评估 Temporal
- 不禁止在具体 Skill 内使用 PydanticAI、LangGraph 等库，但不得让公共 API 和数据库模型依赖其内部类型

---

## 2. 阶段目标与非目标

### 2.1 目标

1. 将“请求绑定的一次聊天流”升级为“独立生命周期的 Agent Run”
2. 支持后台执行、断线重连、事件重放、取消、失败重试和崩溃恢复
3. 建立最小工具注册表与模型工具调用循环，打通 2-3 个无副作用工具
4. 建立风险策略和人工审批状态，为 Phase 6 的真实工具执行做好边界
5. 保持 `/chat/stream` 完全兼容，通过功能开关提供 Agent 模式
6. 提供用户 Run 列表/详情和运营人员只读 Run 诊断页

### 2.2 非目标

- 本阶段不执行任意 Shell、浏览器自动化或用户本机文件操作
- 本阶段不实现完整长期记忆、RAG、Skills 市场和定时任务
- 本阶段不实现用户可视化工作流编辑器或多 Agent 编排
- 本阶段不让 Agent 自动发送邮件、发布内容、付款或删除外部数据
- 本阶段不废弃现有 `Conversation` / `Message` 和 `/chat/stream`

### 2.3 后续阶段总览

| Phase | 文档                                                      | 交付重点                                          |
| ----- | --------------------------------------------------------- | ------------------------------------------------- |
| 5     | 本文                                                      | 可恢复 Run、Step、Event、审批和最小 Agent loop    |
| 6     | [工具与执行](./phase-6-tools-execution.md)                | Tool Runtime、MCP、云沙箱和桌面执行节点           |
| 7     | [记忆与自动化](./phase-7-memory-skills-automation.md)     | 长期记忆、知识库、Skills 和主动任务               |
| 8     | [治理与后台](./phase-8-governance-admin-observability.md) | 权限、成本、安全、用户控制中心和运营后台          |
| 9     | [生活与工作场景](./phase-9-life-work-connectors.md)       | 空间、连接器、场景模板和跨端体验                  |
| 10    | [高级自治](./phase-10-autonomy-delegation-evals.md)       | 有界自治、委派、自我改进和 Agent Evals            |
| 11    | [个人数字孪生](./phase-11-personal-digital-twin.md)       | 目标、承诺、Context Graph 和主动决策支持          |
| 12    | [开放生态](./phase-12-open-ecosystem.md)                  | Skill/Connector 生态、跨渠道、外部 Agent 与自托管 |

依赖主链为 `5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12`。其中客户端适配、连接器开发、评测数据集和可观测性可以提前并行，但不得绕过前一阶段的安全与集成测试许可证。

---

## 3. 总体架构

```text
Web / Mobile / Desktop
        |
        | POST /agent/runs (202)
        v
Agent API -----------------------------------+
        |                                     |
        | 写入 Run + 入队                      | GET /runs/:id/events (SSE)
        v                                     |
Redis Queue                            Agent Event Store
        |                                     ^
        v                                     |
Agent Worker -> RunCoordinator -> ModelGateway -> ai_service.py
                       |               |
                       |               +-> 统一模型事件
                       v
                Tool Registry
                       |
                 Policy Engine
                       |
              执行 / 等待审批 / 失败
                       |
                       v
             PostgreSQL Run/Step/Event
```

关键原则：

- `backend/app/services/ai_service.py` 仍是所有模型调用唯一入口
- HTTP 路由只做参数解析、授权、调用 service 和返回响应
- PostgreSQL 是 Run 状态唯一真相源；Redis 只负责排队、锁和短期广播
- SSE 是事件传输通道，不是状态存储；客户端可随时通过事件序号恢复
- Worker 进程与 FastAPI 进程分离，模型循环不得占用 Web worker

---

## 4. 领域模型与数据库迁移

### 4.1 `assistants`

用户拥有的助理配置。首版每个用户自动创建一个默认助理。

| 字段                        | 类型         | 说明                                                            |
| --------------------------- | ------------ | --------------------------------------------------------------- |
| `id`                        | UUID PK      | 助理 ID                                                         |
| `user_id`                   | UUID FK      | 所属用户，索引                                                  |
| `name`                      | VARCHAR(80)  | 显示名称                                                        |
| `description`               | VARCHAR(500) | 用途描述                                                        |
| `instructions`              | TEXT         | 用户级行为指令，不包含平台安全规则                              |
| `default_model`             | VARCHAR(100) | 默认模型                                                        |
| `autonomy_level`            | ENUM         | `conservative` / `balanced` / `autonomous`，首版默认 `balanced` |
| `is_default`                | BOOLEAN      | 每用户仅一个默认助理                                            |
| `created_at` / `updated_at` | TIMESTAMPTZ  | 审计时间                                                        |

### 4.2 `agent_runs`

| 字段                                       | 类型              | 说明                   |
| ------------------------------------------ | ----------------- | ---------------------- |
| `id`                                       | UUID PK           | Run ID                 |
| `user_id` / `assistant_id`                 | UUID FK           | 租户与助理隔离         |
| `conversation_id`                          | UUID FK NULL      | 可关联现有会话         |
| `parent_run_id`                            | UUID FK NULL      | 重试或后续委派来源     |
| `goal`                                     | TEXT              | 用户原始目标           |
| `status`                                   | ENUM              | 见状态机               |
| `model`                                    | VARCHAR(100)      | 本次实际模型           |
| `max_steps`                                | SMALLINT          | 默认 12，服务端上限 30 |
| `current_step`                             | SMALLINT          | 已执行步数             |
| `idempotency_key`                          | VARCHAR(100) NULL | 防重复创建             |
| `input_tokens` / `output_tokens`           | INTEGER           | 用量                   |
| `estimated_cost_usd`                       | NUMERIC           | 估算成本               |
| `error_code` / `error_message`             | VARCHAR/TEXT NULL | 终态错误               |
| `queued_at` / `started_at` / `finished_at` | TIMESTAMPTZ NULL  | 生命周期               |
| `created_at` / `updated_at`                | TIMESTAMPTZ       | 审计时间               |

唯一约束：`(user_id, idempotency_key)` 在 key 非空时唯一。

### 4.3 `agent_steps`

| 字段                           | 类型              | 说明                                                                     |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| `id`                           | UUID PK           | Step ID                                                                  |
| `run_id`                       | UUID FK           | 所属 Run，级联删除                                                       |
| `sequence`                     | INTEGER           | Run 内严格递增，唯一                                                     |
| `kind`                         | ENUM              | `model` / `tool` / `approval` / `user_input` / `final`                   |
| `status`                       | ENUM              | `pending` / `running` / `waiting` / `succeeded` / `failed` / `cancelled` |
| `input_json` / `output_json`   | JSONB             | 结构化输入输出，写入前脱敏                                               |
| `error_code` / `error_message` | VARCHAR/TEXT NULL | 失败信息                                                                 |
| `started_at` / `finished_at`   | TIMESTAMPTZ NULL  | 执行时间                                                                 |

### 4.4 `agent_events`

持久化所有面向客户端的事件，用于 SSE 重放与审计。

| 字段         | 类型        | 说明                 |
| ------------ | ----------- | -------------------- |
| `id`         | BIGINT PK   | 全局游标             |
| `run_id`     | UUID FK     | Run ID               |
| `sequence`   | INTEGER     | Run 内事件序号，唯一 |
| `event_type` | VARCHAR(60) | 事件类型             |
| `payload`    | JSONB       | 已脱敏事件数据       |
| `created_at` | TIMESTAMPTZ | 创建时间             |

索引：`(run_id, sequence)`、`(run_id, created_at)`。

### 4.5 `approval_requests`

| 字段                           | 类型                  | 说明                                                        |
| ------------------------------ | --------------------- | ----------------------------------------------------------- |
| `id`                           | UUID PK               | 审批 ID                                                     |
| `run_id` / `step_id`           | UUID FK               | 所属执行                                                    |
| `user_id`                      | UUID FK               | 只能由所属用户决定                                          |
| `risk_level`                   | ENUM                  | `low` / `medium` / `high` / `critical`                      |
| `action_summary`               | VARCHAR(500)          | 用户可理解的动作摘要                                        |
| `arguments_preview`            | JSONB                 | 脱敏参数预览                                                |
| `payload_hash`                 | VARCHAR(64)           | 防止审批后参数被替换                                        |
| `status`                       | ENUM                  | `pending` / `approved` / `denied` / `expired` / `cancelled` |
| `expires_at`                   | TIMESTAMPTZ           | 默认 24 小时                                                |
| `decided_at` / `decision_note` | TIMESTAMPTZ/TEXT NULL | 决策记录                                                    |

---

## 5. Run 状态机

```text
queued -> running -> succeeded
             |  \
             |   -> failed
             |   -> cancelled
             |
             +-> waiting_approval -> queued
             |                    -> cancelled
             |
             +-> waiting_input ----> queued
                                  -> cancelled
```

允许状态迁移必须集中在 `RunStateMachine`，禁止路由或 Worker 直接赋值：

- `queued -> running`：Worker 取得租约
- `running -> waiting_approval`：工具策略要求确认
- `running -> waiting_input`：信息不足且模型明确请求澄清
- `waiting_* -> queued`：用户操作完成后重新入队
- 任意非终态 `-> cancelled`：用户取消或达到安全上限
- `running -> failed`：不可重试错误或重试耗尽
- `running -> succeeded`：生成最终结果并完成落库

Run 租约字段存 Redis，TTL 60 秒，每 20 秒续租；Worker 崩溃后由恢复任务扫描 `running` 且租约丢失的 Run，安全地重新排队。Step 和工具调用必须用幂等键避免重复副作用。

---

## 6. 模型事件与 Agent 循环

### 6.1 `ai_service.py` 扩展

保留现有 `stream_chat()`，新增归一化接口：

```python
async def stream_agent(
    model: str,
    messages: list[ModelMessage],
    tools: list[ToolDefinition],
    *,
    enable_thinking: bool = False,
) -> AsyncGenerator[ModelEvent, None]:
    ...
```

`ModelEvent` 只允许以下类型：

- `ThinkingDelta`
- `ContentDelta`
- `ToolCallStart`
- `ToolCallArgumentsDelta`
- `ToolCallEnd`
- `UsageDelta`
- `ModelCompleted`
- `ModelFailed`

Provider 差异只在 `ai_service.py` 内转换，Agent service 不得读取 OpenAI/Anthropic SDK 对象。

### 6.2 有界执行循环

```text
1. 加载 Run、助理指令、会话上下文和允许工具
2. 调用 stream_agent
3. 逐事件持久化 agent_events，并广播给在线客户端
4. 若模型返回最终答案：保存 Message，Run -> succeeded
5. 若模型请求工具：校验 schema、预算、策略和重复调用
6. 若需审批：创建 Approval，Run -> waiting_approval，释放 Worker
7. 若可执行：记录 Step，调用 ToolRegistry，结果追加为 tool message
8. 回到步骤 2，直到完成或达到 max_steps
```

强制上限：

- 每个 Run 默认最多 12 Step，硬上限 30
- 单次模型调用 60 秒，单工具默认 30 秒
- 同一工具 + 同一参数连续出现 3 次，终止并返回 `AGENT_LOOP_DETECTED`
- 达到 token、金额或时间预算后进入 `waiting_approval`，不得静默继续消费

---

## 7. 最小工具注册表

本阶段只实现注册、schema 校验和无外部副作用工具：

- `get_current_time`
- `calculate`
- `inspect_uploaded_file_metadata`

统一契约：

```python
class ToolSpec(BaseModel):
    name: str
    description: str
    input_schema: dict[str, object]
    output_schema: dict[str, object] | None
    risk_level: ToolRisk
    execution_location: Literal["cloud", "desktop", "either"]
    timeout_seconds: int
    idempotent: bool
```

Phase 5 的 ToolRegistry 只接受代码内显式注册；MCP、插件、Shell、浏览器和桌面工具在 Phase 6 实现。

---

## 8. Agent SSE 协议

### 8.1 创建与订阅分离

```http
POST /api/v1/agent/runs
Idempotency-Key: <client-generated>

HTTP/1.1 202 Accepted
{"run_id":"uuid","status":"queued","events_url":"/api/v1/agent/runs/uuid/events"}
```

```http
GET /api/v1/agent/runs/{run_id}/events
Last-Event-ID: 42
Accept: text/event-stream
```

服务端先从 `agent_events` 重放 `sequence > Last-Event-ID`，再订阅 Redis 广播；Redis 消息丢失时仍可从数据库补齐。

### 8.2 事件清单

| SSE event           | 核心字段                                                       |
| ------------------- | -------------------------------------------------------------- |
| `run_start`         | `run_id`, `model`, `max_steps`                                 |
| `step_start`        | `step_id`, `sequence`, `kind`                                  |
| `thinking_delta`    | `token`                                                        |
| `content_delta`     | `token`                                                        |
| `tool_call_start`   | `tool_execution_id`, `name`, `risk_level`                      |
| `tool_call_delta`   | `tool_execution_id`, `args_chunk`                              |
| `approval_required` | `approval_id`, `summary`, `expires_at`                         |
| `tool_call_end`     | `tool_execution_id`, `status`, `result_preview`, `duration_ms` |
| `input_required`    | `request_id`, `question`                                       |
| `artifact_created`  | `artifact_id`, `name`, `mime_type`                             |
| `run_waiting`       | `reason`                                                       |
| `run_end`           | `status`, `usage`, `finish_reason`                             |
| `error`             | `code`, `message`, `retryable`                                 |

事件字段统一使用 `snake_case`。现有 `/chat/stream` 协议保持不变，`packages/core` 新增 `useAgentRun`，不要继续扩大 `useStream` 的职责。

---

## 9. API 设计

### 9.1 用户接口

| 方法  | 路径                             | 说明                  |
| ----- | -------------------------------- | --------------------- |
| GET   | `/agent/assistants`              | 助理列表              |
| POST  | `/agent/assistants`              | 创建助理              |
| PATCH | `/agent/assistants/{id}`         | 修改助理配置          |
| GET   | `/agent/runs`                    | Run 列表，cursor 分页 |
| POST  | `/agent/runs`                    | 创建 Run，返回 202    |
| GET   | `/agent/runs/{id}`               | Run 当前快照          |
| GET   | `/agent/runs/{id}/steps`         | Step 列表             |
| GET   | `/agent/runs/{id}/events`        | 可重放 SSE            |
| POST  | `/agent/runs/{id}/cancel`        | 取消 Run              |
| POST  | `/agent/runs/{id}/input`         | 回答澄清问题          |
| POST  | `/agent/approvals/{id}/decision` | 批准或拒绝            |

### 9.2 最小运营接口

仅 `operator` / `admin` 可访问：

- `GET /admin/agent/runs`：按用户、状态、模型、错误码筛选
- `GET /admin/agent/runs/{id}`：脱敏的 Run/Step/Event 详情
- `POST /admin/agent/runs/{id}/retry`：仅允许重试无副作用或已确认幂等的步骤
- `POST /admin/agent/runs/{id}/cancel`

不得提供“替用户批准高风险操作”的接口。

---

## 10. 代码结构

```text
backend/app/
├── api/v1/agent.py
├── api/v1/admin_agent.py
├── models/
│   ├── assistant.py
│   ├── agent_run.py
│   └── approval.py
├── schemas/agent.py
├── services/agent/
│   ├── run_service.py
│   ├── coordinator.py
│   ├── state_machine.py
│   ├── context_builder.py
│   ├── event_service.py
│   ├── approval_service.py
│   └── errors.py
├── tools/
│   ├── registry.py
│   ├── contracts.py
│   └── builtin/
└── workers/
    ├── settings.py
    ├── agent_worker.py
    └── recovery_worker.py
```

`backend/app/api/v1/chat.py` 当前包含消息保存、上下文拼装和 SSE 生成等业务逻辑。Phase 5 开始前先将其提取到 service，但必须保持接口响应和现有测试不变；Agent 不得复制这段路由逻辑。

---

## 11. 前端功能

### 11.1 Chat Agent 模式

- 模型选择器旁增加“聊天 / Agent”模式切换，默认仍为聊天
- Agent 发送后立即显示 Run 卡片，不等待第一个 token
- 展示当前状态、步骤时间线、工具调用、审批卡、澄清卡和取消按钮
- 页面刷新或切换设备后通过 Run 快照 + `Last-Event-ID` 恢复
- Run 完成后最终回答仍落入现有消息历史，保持搜索和分享兼容

### 11.2 用户控制中心最小版

- `/settings/agent`：默认助理名称、指令、默认模型、自主级别
- `/agent/runs`：历史 Run、状态、耗时、Step 数和错误
- `/agent/approvals`：等待审批列表；同一审批只允许一次决定

### 11.3 运营后台最小版

- `/admin/agent-runs`：只读列表与详情
- 支持状态、时间、模型、用户和错误码过滤
- 默认隐藏完整 prompt、文件内容、密钥和工具敏感参数

---

## 12. 安全与隐私基线

- 所有查询必须显式带 `user_id`，并补用户 A 不能访问用户 B Run 的集成测试
- Tool 参数必须先通过 JSON Schema/Pydantic 校验，再进入策略引擎
- 系统安全指令、平台策略、用户指令分层拼装，用户内容不能覆盖前两层
- Approval 绑定工具名、参数哈希、执行位置和过期时间；任一变化必须重新审批
- Agent Event 写入前执行字段级脱敏；禁止保存 Authorization、Cookie、API Key
- 用户取消后停止后续模型调用，正在执行的工具通过取消 token 尽力终止
- 错误响应使用稳定错误码，不把堆栈、SQL 或 provider 原始密钥错误返回前端
- 本阶段所有工具均为低风险、无外部副作用；审批链仍必须用模拟工具测试

---

## 13. 测试要求

### 13.1 单元测试

- RunStateMachine 全部合法与非法迁移
- ToolRegistry 注册冲突、schema 校验、超时和错误包装
- PolicyEngine 风险映射与审批判定
- Agent loop 完成、工具调用、循环检测、步数/预算耗尽
- Event 序号单调、脱敏和 SSE 编码
- 崩溃租约恢复与幂等键

### 13.2 后端集成测试

- 创建 Run -> Worker 执行 -> SSE 重放 -> Run 成功
- SSE 断线后携带 `Last-Event-ID` 不丢事件、不重复最终结果
- 模拟工具需要审批 -> 用户批准 -> Run 恢复
- 用户拒绝或审批过期 -> Run 进入正确终态
- Worker 在 Step 中途崩溃 -> 租约过期 -> 恢复执行且不重复副作用
- 用户 A 无法读取、取消或审批用户 B 的 Run
- `/chat/stream` 全部现有集成测试继续通过

### 13.3 前端集成/E2E

- Agent 模式创建 Run 并展示完整步骤时间线
- 刷新页面后恢复正在运行的 Run
- 审批卡批准、拒绝、过期和重复点击
- 取消 Run 后 UI 不再追加事件
- Chat 模式行为无回归

---

## 14. 可观测性与指标

首版记录结构化指标，不记录未经授权的原始内容：

- `agent_runs_total{status,model}`
- `agent_run_duration_seconds`
- `agent_steps_per_run`
- `agent_tool_calls_total{tool,status}`
- `agent_approval_wait_seconds`
- `agent_recovery_total{reason}`
- `agent_tokens_total{model,direction}`
- `agent_estimated_cost_usd{model}`

每个日志和 trace 必须携带 `run_id`、`step_id`（如有）和不可逆哈希后的 `user_id`。

---

## 15. 交付顺序

1. 将现有 Chat 路由业务逻辑移入 service，建立回归基线
2. 新增数据库模型、迁移和状态机
3. 扩展 `ai_service.py` 的归一化工具调用事件
4. 实现 EventStore、Redis Queue、Worker 和恢复任务
5. 实现最小 ToolRegistry 与无副作用工具
6. 实现审批和澄清暂停/恢复
7. 实现 Agent API、`packages/types` 和 `useAgentRun`
8. 实现 Web Agent 时间线、用户设置与最小运营页
9. 完成集成测试、SSE 重连测试和故障注入测试
10. 通过功能开关对内部用户灰度

---

## 16. 验收标准

- [ ] 用户创建 Agent Run 后 HTTP 在 500ms 内返回 202
- [ ] 客户端断线 5 分钟后重连仍能完整恢复事件与最终结果
- [ ] Worker 强制退出后 Run 能自动恢复，事件和 Step 不重复
- [ ] Agent 能完成至少一个包含两次工具调用的测试任务
- [ ] 模拟高风险工具会暂停并等待用户审批，未审批绝不执行
- [ ] 达到步数、时间、token 或金额上限时可预测地停止
- [ ] 用户 A 无法访问用户 B 的任何 Agent 数据
- [ ] 运营页可定位失败 Step，但看不到凭证和未授权敏感内容
- [ ] 原有 Chat、认证、文件和分享集成测试无回归
- [ ] `ruff`、`mypy`、ESLint、TypeScript typecheck 和相关测试全部通过

**进入 Phase 6 的许可证**：上述验收全部通过，尤其是审批暂停/恢复、SSE 重放、崩溃恢复和租户隔离集成测试。

### 当前证据索引

| 验收域                                    | 证据                                                                                            | 状态   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Run 创建、幂等、功能开关                  | `backend/tests/integration/test_agent_api.py`                                                   | 已覆盖 |
| SSE 事件持久化与 `Last-Event-ID` 重放     | `backend/tests/integration/test_agent_api.py`、`backend/app/services/agent/event_service.py`    | 已覆盖 |
| 审批参数绑定、单次决定、过期与租户隔离    | `backend/tests/integration/test_agent_approval.py`、`backend/tests/unit/test_agent_approval.py` | 已覆盖 |
| 队列 lease、取消、恢复和幂等              | `backend/tests/unit/test_agent_runtime_workers.py`                                              | 已覆盖 |
| Web Agent 页面与 Chat 回归                | `apps/web/src`、`apps/web/tests`、根目录前端测试脚本                                            | 已覆盖 |
| 真实模型驱动的完整 Agent 两工具链         | 当前未配置可用模型 Key 的实跑证据                                                               | 未验证 |
| 强制退出后的真实进程恢复与 5 分钟断线演练 | 当前测试为组件/集成级模拟                                                                       | 未验证 |

因此，Phase 5 的代码合同和自动化测试门槛已具备，但“真实外部模型两工具链”和“真实进程
故障演练”仍须在配置对应服务后单独完成，不能仅凭本地单元测试宣称全部运行时验收通过。
