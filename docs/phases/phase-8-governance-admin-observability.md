# Phase 8 - 安全治理、用户控制中心、运营后台与可观测性

- **前置条件**：Phase 7 的记忆、知识 ACL、Skill 回滚和自动化幂等通过
- **并行关系**：部分基础能力从 Phase 5 起逐步建设；本阶段完成公开 Beta 前的生产化门禁
- **建议分支**：`feat/phase-8-agent-governance`
- **执行范围**：`backend/`、`apps/web/`、`packages/types/`、部署配置和 CI；不新增高风险业务连接器
- **阶段定位**：把“能运行的 Agent”升级为“用户敢授权、团队能运营、事故可追踪”的产品

---

## 1. 核心决策

### 1.1 后台必须自建产品层

不 fork Hermes Dashboard 或通用 Admin 模板作为业务底座。原因：

- Hermes Dashboard 面向单机配置文件、`.env` 和本地 Profile，不符合多用户/多租户数据模型
- yuanai 后台需要统一使用现有认证、Next.js、设计系统、国际化和 API Client
- Agent Run、审批、用户连接、成本、租户和数据权利是产品领域，不是 CRUD 皮肤

允许复用：表格、图表、权限组件、OpenTelemetry Collector、Langfuse、Prometheus、Grafana、Sentry 等专用开源基础设施。

### 1.2 两个控制面

| 控制面       | 服务对象       | 核心职责                                                   |
| ------------ | -------------- | ---------------------------------------------------------- |
| 用户控制中心 | 普通用户       | 管理助理、数据、连接、设备、权限、预算、记忆和自动化       |
| 运营管理后台 | operator/admin | 用户与租户、模型、成本、失败任务、安全事件、审计和平台策略 |

运营人员默认不能查看用户原始内容，必须采用最小权限、显式提权和可审计的 break-glass 流程。

---

## 2. 身份、租户与 RBAC

### 2.1 角色

- `user`：只管理自己的数据和设备
- `workspace_member`：访问被邀请的共享空间
- `workspace_admin`：管理空间成员、预算、连接和策略
- `support`：查看脱敏运行诊断，不能读取内容或凭证
- `operator`：平台模型、队列、限额和功能开关
- `security_admin`：安全策略、审计与 break-glass 审批
- `platform_admin`：最高平台权限，不用于日常操作

权限采用 resource + action + scope，不在代码中散落 `is_admin` 判断。

### 2.2 多租户

当前个人用户仍视为一个 personal tenant，为未来家庭、团队和组织共享做准备：

- 所有 Agent 核心表增加明确 `tenant_id`
- repository/service 查询必须注入 TenantContext
- PostgreSQL 可在公开 Beta 前评估 Row Level Security，应用层隔离测试仍不可省略
- 对象存储 key、Redis key、队列和 trace 均包含不可猜测的 tenant namespace

### 2.3 高权限操作

- 管理员开启用户内容访问前，需要工单号、原因、时间上限和二次认证
- 默认只允许用户主动提交的诊断包
- break-glass 需要两人审批或安全管理员批准
- 访问开始、字段、导出和结束都写入不可变审计日志，并通知用户（法律禁止时除外）

---

## 3. 用户控制中心

### 3.1 信息架构

```text
设置
├── 我的助理
├── 隐私与记忆
├── 知识与数据
├── 工具与连接
├── 设备与本机执行
├── 自动化
├── 权限与审批
├── 用量与预算
├── 通知
└── 数据导出与删除
```

### 3.2 权限总览

以“能力”而非技术协议展示：

- 可读取什么
- 可修改什么
- 可代表用户对外发送什么
- 在云端还是本机执行
- 哪些授权是单次、限时或长期
- 最近使用时间和对应 Run

提供“暂停全部 Agent 执行”和“撤销全部连接/设备”的紧急按钮。

### 3.3 用量与预算

- 今日/本月 token、工具、沙箱、存储和第三方 API 成本
- 按助理、自动化、模型和空间拆分
- 用户级软提醒与硬上限
- 每个自动化可独立设置单次/每日/月度预算
- 达到硬上限后现有 Run 进入 waiting，不静默换便宜模型或继续扣费

### 3.4 数据权利

- 导出：会话、Run、记忆、知识元数据、Skills、自动化和审计摘要
- 删除：按数据类型或全部账号，显示异步删除进度
- 保留：用户可为会话、浏览器截图、工具日志和 Artifact 设定策略
- 本地数据：列出保存在哪个节点，支持远程发起清除并等待节点确认

---

## 4. 运营管理后台

### 4.1 页面

```text
/admin
├── overview
├── users
├── tenants
├── agent-runs
├── approvals
├── tools-and-connectors
├── execution-nodes
├── models-and-providers
├── usage-and-cost
├── automations
├── queues-and-dlq
├── safety-events
├── audit-log
├── feature-flags
└── system-health
```

### 4.2 Overview

- Run 成功率、P50/P95 时长、排队时间和活跃用户
- Tool 成功率、审批等待、桌面节点在线率
- token、模型、沙箱和第三方工具成本
- 失败热点、循环终止、超预算和安全拦截
- 数据只展示聚合值，不展示 prompt 文本

### 4.3 Run 诊断

- 状态机时间线、Step、重试、模型、工具、节点和错误码
- Prompt/Tool 参数默认显示字段结构和哈希，不显示原始内容
- 用户提交诊断授权后，支持限定字段和限定时间的临时查看
- 只允许对满足幂等条件的 Step 发起 retry
- “强制标记成功”被禁止；修复必须产生新的 Run/Step

### 4.4 Queue 与 DLQ

- 分队列深度、最老任务、消费速率和 Worker 心跳
- 死信任务显示错误分类、重试次数和安全副作用状态
- 批量重试只能作用于明确无副作用错误
- 高风险副作用状态未知时进入 `manual_reconciliation`，不能自动重放

---

## 5. 模型与 Provider 控制面

将模型元数据从 `ai_service.py` 的静态列表逐步迁移为“代码 adapter + 数据库配置”：

- Adapter 仍在代码中，负责协议和能力实现
- 数据库保存启停、展示名、上下文、价格、区域、限额和灰度规则
- 模型能力：vision、tools、reasoning、structured_output、max_context
- 用户请求的模型与实际路由模型都写入 Run
- Provider Key 保存在 SecretStore，不通过后台 API 回传明文

### 5.1 路由策略

- 默认模型、允许列表、故障 fallback 和区域策略
- 不同任务类型的能力约束，不能只按价格选择
- fallback 必须记录原因；涉及数据区域变化时需要用户策略允许
- 管理员可熔断某 Provider/模型，新 Run 停止使用，运行中请求按策略结束

### 5.2 成本核算

- 保存模型价格版本和生效时间，历史 Run 使用当时价格
- 区分输入、输出、缓存、reasoning、embedding、图像和音频
- 第三方工具与沙箱成本统一归集到 Run
- 估算值和 Provider 账单对账值分开保存

---

## 6. Policy 控制面

### 6.1 策略层级

```text
平台不可覆盖策略
  -> 租户策略
    -> 用户策略
      -> 助理/空间策略
        -> 单次 Run 临时授权
```

下层只能收紧上层禁止项，不能放宽平台硬限制。

### 6.2 策略内容

- 工具/连接器允许列表
- 风险等级审批要求
- 数据分级与允许执行位置
- 域名、目录、仓库、收件人等资源作用域
- 单次/每日/月度预算
- Run 最大时间、Step、子 Agent 和并发
- 数据保留与 trace 内容级别

策略变更必须版本化；每次 ToolExecution 保存生效策略版本，便于事故复盘。

---

## 7. 审计日志

### 7.1 必须审计

- 登录、Token 刷新、MFA、设备配对和撤销
- Secret/连接创建、使用、轮换和删除
- 审批创建与决定
- 高风险工具调用及参数摘要哈希
- 管理员操作、策略/模型/功能开关变化
- 数据导出、删除和 break-glass

### 7.2 不可变性

- 审计表 append-only，应用账号无 UPDATE/DELETE 权限
- 每条记录包含前一条 hash，定期生成批次 Merkle root
- 定期归档到 WORM 对象存储或等价不可变存储
- 审计 payload 仍必须最小化，不能借“审计”之名复制全部敏感内容

---

## 8. 可观测性

### 8.1 技术选择

- OpenTelemetry：统一 trace、metric、log 上下文
- Langfuse（自托管优先）：LLM/Agent trace、prompt 版本和评测；默认不采集敏感正文
- Prometheus + Grafana：系统与业务指标
- Sentry 或等价平台：客户端/服务端异常和 release 关联
- PostgreSQL/Redis/Worker exporter：基础设施健康

外部组件通过 adapter 接入；yuanai 数据库仍保存用户可见 Run/Step 真相。

### 8.2 Trace 结构

```text
Agent Run span
├── context.build
├── model.call
├── policy.evaluate
├── approval.wait
├── tool.execute
│   ├── sandbox.start
│   └── artifact.store
└── memory.extract
```

禁止把 token、Cookie、Authorization、完整文件内容、健康/财务私密数据写入 span attribute。

### 8.3 SLO

公开 Beta 目标：

- Agent API 创建 Run：P99 < 500ms
- Event SSE 可用性：99.9%
- 已接收事件持久化丢失率：0
- 云端只读工具成功率：>= 98%
- 高风险工具未审批执行：0
- Run 崩溃自动恢复：P95 < 2 分钟
- 数据删除任务：99% 在 24 小时内完成

---

## 9. 安全工程

### 9.1 Threat Model

至少覆盖：

- Prompt injection 与间接 Prompt injection
- Confused deputy：用户借 Agent 使用不属于自己的权限
- Tool/MCP supply chain、schema 替换和恶意更新
- SSRF、数据外传、沙箱逃逸和资源耗尽
- Desktop Node 冒充、重放、降级攻击和本地恶意软件
- OAuth token 泄漏、跨租户访问和管理员滥权
- 记忆投毒、知识库投毒和 Skill 自我修改
- 定时任务无人值守扩大损失

Threat model 进入仓库内部安全文档或 ADR；公开 Phase 只记录要求，不存放真实密钥/基础设施细节。

### 9.2 安全措施

- 管理员和高风险用户操作强制 MFA
- SecretStore key rotation 与 envelope encryption
- OAuth 使用最小 scope、PKCE、state 和短期 access token
- API、Webhook、SSE、WSS 分别限流
- MCP/Skill/容器镜像生成 SBOM，依赖漏洞扫描和签名验证
- 桌面自动更新必须签名；协议版本有最低安全版本
- 安全事件支持一键熔断工具、连接器、模型或执行节点

### 9.3 内容安全与拒绝

平台需要独立于模型的安全策略层。安全拒绝不应依赖单一模型自觉；工具执行前再次检查目标、参数、数据流向和风险。

---

## 10. 隐私与数据分级

| 等级       | 示例                             | 默认处理                                  |
| ---------- | -------------------------------- | ----------------------------------------- |
| Public     | 公开网页、公共文档               | 可云端处理                                |
| Personal   | 普通日程、个人偏好               | 云端加密，可关闭训练/采样                 |
| Sensitive  | 私人邮件、内部工作资料、精确位置 | 最小保留，trace 默认只存元数据            |
| Restricted | 密码、证件、健康/财务核心资料    | 不进入模型或仅在用户指定本地模型/节点处理 |

每个 ToolSpec、Connector、KnowledgeSource 和 Memory 都声明可处理的最高等级及数据出境区域。

---

## 11. Feature Flags 与灰度

- Feature flag 作用域：全局、租户、用户、客户端版本和百分比
- 高风险功能默认 allowlist 灰度
- Flag 变化写审计并支持紧急 kill switch
- 关闭功能不能让运行中高风险 Step 继续；Coordinator 在每个 Step 前检查策略版本
- 客户端对未知功能和事件保持向后兼容

---

## 12. API 与代码结构

```text
backend/app/
├── api/v1/admin/
│   ├── users.py
│   ├── runs.py
│   ├── models.py
│   ├── costs.py
│   ├── policies.py
│   ├── audit.py
│   └── system.py
├── services/governance/
│   ├── rbac_service.py
│   ├── policy_service.py
│   ├── audit_service.py
│   ├── budget_service.py
│   ├── retention_service.py
│   └── break_glass_service.py
└── observability/
    ├── tracing.py
    ├── metrics.py
    └── redaction.py

apps/web/src/app/
├── (main)/settings/agent/**
└── (admin)/admin/**
```

Admin Schema 与普通用户 Schema 分开定义，禁止直接序列化 ORM；敏感字段在 service 层就不进入 response object。

---

## 13. 测试与演练

### 13.1 权限测试

- 每个 Admin API 的角色/作用域矩阵
- 跨租户、ID 枚举、对象存储和 Redis key 隔离
- support/operator 无法读取原始内容和 Secret
- break-glass 超时、撤销、双人审批和通知

### 13.2 成本与策略测试

- 并发 Run 下预算原子扣减
- 达到软/硬上限的行为
- Provider fallback 的能力、区域和成本约束
- 策略版本切换时运行中 Step 的一致性

### 13.3 安全演练

- 恶意网页诱导发信/上传资料
- 恶意 MCP 更新 schema
- Desktop 密钥被撤销后重放旧 Job
- Worker 重复执行外部副作用
- 管理员账户泄漏后的最小影响验证
- Secret 泄漏与 Provider 熔断演练

### 13.4 灾难恢复

- PostgreSQL point-in-time restore
- Redis 全丢失后从 DB 恢复 Run
- 对象存储版本恢复
- 审计归档验证
- RPO/RTO 演练结果进入发布门禁

---

## 14. 验收标准

- [ ] 用户能清楚查看并撤销工具、设备、记忆和自动化权限
- [ ] 用户能设置预算硬上限，超限后无额外消费
- [ ] 运营后台能定位失败 Run、队列拥堵和成本异常
- [ ] support/operator 默认无法查看用户原始内容和 Secret
- [ ] 高风险策略、管理员操作和 break-glass 全部可审计
- [ ] Prompt injection、SSRF、跨租户和重复副作用演练通过
- [ ] OpenTelemetry trace 能串联 Run、模型、工具、审批和 Worker
- [ ] kill switch 能在规定时间内停止新高风险执行
- [ ] 数据导出/删除和本地节点清除流程可验证
- [ ] 生产 SLO 仪表盘、告警和 Runbook 已就绪

**进入 Phase 9 的许可证**：安全评审无未处理高危问题，租户隔离、预算硬限、break-glass、kill switch 和恢复演练全部通过。
