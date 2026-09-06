# Phase 7 - 长期记忆、知识库、Skills 与主动自动化

- **前置条件**：Phase 6 工具链、审批、沙箱和执行节点达到验收标准；Phase 6 文档中仍开放的
  系统性安全测试、Browser Worker 安全灰度与生产部署验收完成后方可开工
- **建议分支**：`feature/phase-7-memory-skills-automation`
- **执行范围**：`backend/`、`packages/types/`、`packages/core/`、`apps/web/`，Mobile/Desktop 补对应控制界面
- **阶段定位**：让 Agent 从“一次性执行器”成长为了解用户、复用经验并能主动工作的长期助理

> **阶段入口状态（2026-09-07）**：Phase 7 暂未获准开工。Phase 6 九个验收项已全部勾选并有真实证据
> （含强制重启任务重投、结果级 spool 重放、重连风暴演练、系统选择器文件授权 E2E、真实 provider
> 四步链），相关提交已合入 `dev` 且远程 CI 三项 job 通过；但这不构成 Phase 7 开工许可。仍开放
> 的前置条件以 Phase 6 文档为准：系统性安全测试（Prompt injection、审批后参数替换的系统性
> 执行）、Browser Worker 完整安全灰度，以及生产/部署环境验收。另有“真实外部 MCP 经 Web 控制
> 中心 UI 的完整链路”一项开放边界，随 Phase 6 收尾一并补验。当前状态见
> [Phase 6 工具与执行](./phase-6-tools-execution.md)。

---

## 1. 产品目标

本阶段要回答四个问题：

1. 助理应该长期记住什么，什么不应该记住？
2. 用户资料、知识文档和历史经验如何进入上下文，而不污染事实？
3. 一次成功任务如何沉淀为可复用 Skill，而不是每次重新推理？
4. 用户离线时，助理如何由时间或事件触发并继续执行？

适用人群不限于 OPC：

- 日常生活：行程、家庭事务、购物研究、旅行计划、健康资料整理
- 学习研究：课程资料、论文、笔记、复习计划和长期项目
- 普通工作：邮件、会议、文档、数据、项目任务和团队沟通
- 专业/OPC：客户、内容、经营指标、自动化报告和重复运营流程

### 1.1 非目标

- 不把全部聊天原文无差别写入“记忆”
- 不把向量相似度结果直接当成事实
- 不允许 Agent 自动修改已生效 Skill 而不经过评测与用户确认
- 不允许定时任务绕过工具权限、审批、预算和数据分级
- 不在本阶段实现面向第三方的 Skills 市场

---

## 2. 记忆分类

```text
                    User Context
      +-------------------+-------------------+
      |                   |                   |
   Profile Memory     Episodic Memory     Semantic Memory
   身份/偏好/规则      发生过的任务与结果     稳定事实与关系
      |                   |                   |
      +-------------------+-------------------+
                          |
                   Procedural Memory
                   Skills / Playbooks

Knowledge Base 与以上记忆分离：它是用户提供的外部资料，不等于关于用户的事实。
```

| 类型       | 示例                                   | 默认保存策略                             |
| ---------- | -------------------------------------- | ---------------------------------------- |
| Profile    | 称呼、语言、时区、输出偏好、无障碍需求 | 用户明确填写或确认后长期保存             |
| Preference | “旅行优先高铁”“报告先给结论”           | 候选 -> 用户确认或高置信度后激活         |
| Semantic   | 人物、项目、组织、稳定关系             | 带来源、置信度和有效期                   |
| Episodic   | 某次旅行计划、会议结论、任务结果       | 摘要保存，按保留期过期                   |
| Procedural | “每周报告如何生成”                     | 以版本化 Skill 保存并测试                |
| Sensitive  | 健康、财务、证件、私密关系             | 默认不自动记忆；用户显式授权且可设为本地 |

---

## 3. 数据模型

### 3.1 `memories`

| 字段                                       | 说明                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `id`, `user_id`, `assistant_id`            | 所属范围                                             |
| `workspace_id`                             | 可选，仅在某生活/学习/工作空间有效                   |
| `memory_type`                              | profile / preference / semantic / episodic           |
| `content`                                  | 面向用户的可读内容                                   |
| `structured_data`                          | 实体、关系、时间范围等 JSONB                         |
| `source_type`, `source_id`                 | 用户输入、Run、文件或连接器来源                      |
| `source_excerpt`                           | 最小必要证据，不保存整段敏感原文                     |
| `confidence`                               | 0-1，不代表事实真伪，只表示候选可信度                |
| `sensitivity`                              | public / personal / sensitive / restricted           |
| `storage_location`                         | cloud / local_node                                   |
| `status`                                   | candidate / active / rejected / superseded / expired |
| `valid_from`, `valid_until`                | 时间有效性                                           |
| `embedding`                                | pgvector，可空                                       |
| `search_vector`                            | PostgreSQL FTS                                       |
| `created_at`, `updated_at`, `last_used_at` | 生命周期                                             |

### 3.2 `memory_relations`

表示“用户 - 属于 - 项目”“联系人 - 就职于 - 公司”等关系。首版使用关系表 + JSONB，不引入独立图数据库。只有当跨实体图遍历成为性能瓶颈时再评估 Neo4j。

### 3.3 知识库模型

- `knowledge_bases`：名称、空间、权限、默认检索策略
- `knowledge_sources`：上传、URL、云盘、Notion、GitHub 等来源
- `knowledge_documents`：源文档版本、哈希、状态和解析器
- `knowledge_chunks`：内容、页码/章节、embedding、FTS、ACL 和来源定位
- `ingestion_jobs`：抓取、解析、OCR、切块、向量化的状态与错误

### 3.4 Skills 模型

- `skills`：稳定 ID、所有者、来源、状态、风险和当前版本
- `skill_versions`：manifest、SKILL.md、脚本/模板引用、校验哈希
- `skill_tool_requirements`：工具、连接、作用域和最低版本
- `skill_evaluations`：测试集、通过率、成本、延迟和安全结果
- `skill_installations`：用户/助理/空间级启用状态

### 3.5 自动化模型

- `automations`：名称、目标、助理、Skill、预算、审批策略
- `automation_triggers`：cron / once / webhook / connector_event
- `automation_runs`：触发来源与 Agent Run 的映射
- `webhook_endpoints`：随机 ID、签名密钥引用、限流和最后使用时间

---

## 4. 记忆写入流程

```text
Run 成功
  -> MemoryExtractor 生成候选
  -> PII/Sensitivity 分类
  -> 与现有记忆去重、冲突检测
  -> Policy 决定：丢弃 / candidate / 自动激活
  -> 用户可查看、修改、确认、拒绝
  -> active 记忆才允许进入后续上下文
```

### 4.1 自动激活条件

只有同时满足以下条件才允许自动激活：

- 不属于 sensitive/restricted
- 用户在同一事实上的明确表达至少出现一次，或多次行为一致
- 没有与现有 active 记忆冲突
- 内容是稳定偏好/身份信息，而非临时状态
- 用户没有关闭该记忆类型

其余内容进入 candidate，并在“助理学到了什么”中集中确认，避免频繁打断。

### 4.2 冲突与遗忘

- 新事实不覆盖旧事实，而是将旧记忆标记 `superseded` 并保留来源链
- 时间敏感事实必须有 `valid_until` 或衰减策略
- 长期未使用且低置信度的 episodic memory 自动过期
- 用户删除记忆后同时删除 embedding、缓存和派生摘要
- “不要再记住此类内容”形成负向策略，MemoryExtractor 必须执行

---

## 5. 记忆检索与上下文组装

### 5.1 混合检索

首版使用 PostgreSQL：

- pgvector 做语义召回
- `tsvector` 做关键词/实体召回
- 时间、空间、敏感级别和 ACL 做过滤
- Reciprocal Rank Fusion 合并结果
- 小模型或规则 rerank，禁止只靠 embedding 距离

### 5.2 Context Budget

上下文按稳定层级组装：

1. 平台安全策略
2. 助理身份与用户显式规则
3. 当前空间/项目上下文
4. 当前任务需要的工具和 Skill
5. 经检索的 active memory
6. 知识库片段与引用
7. 最近会话和当前 Run

每层有独立 token 预算。检索结果必须携带来源 ID，最终回答引用知识库时能够回到原文位置。

### 5.3 本地记忆

`storage_location=local_node` 的记忆只保存加密索引元数据和节点 ID；检索请求路由到在线桌面节点。节点离线时：

- 不静默改用云端副本
- 向 Agent 返回“本地私密记忆暂不可用”
- 用户可选择等待或在本次任务中手动提供

---

## 6. 知识库摄取

### 6.1 Pipeline

```text
Source Fetch -> Virus Scan -> Parse/OCR -> Normalize
             -> Structure Aware Chunk -> Embed + FTS
             -> Quality Check -> Publish New Version
```

新版本构建完成前继续服务旧版本；发布采用原子切换。失败文档不得产生半成品检索结果。

### 6.2 切块原则

- Markdown/HTML 按标题与语义块
- PDF 保留页码、标题、表格和图片引用
- Spreadsheet 按 sheet + 表区域，不按固定字符粗暴切割
- 代码按符号和文件路径，优先使用 AST
- 邮件/聊天按线程与消息边界

### 6.3 权限

Chunk 继承 Source ACL。任何检索都必须先做权限过滤，再做相似度排序；禁止先跨租户向量召回后在应用层过滤。

---

## 7. Skills 规范

### 7.1 格式

兼容 `agentskills.io` / `SKILL.md` 思路，yuanai manifest 至少包含：

```yaml
id: yuanai.research.brief
version: 1.0.0
name: Research Brief
description: 将多个可信来源整理为带引用的研究简报
entrypoint: SKILL.md
required_tools:
  - yuanai.web.search@^1
  - yuanai.web.extract@^1
risk_ceiling: read
inputs_schema: schemas/input.json
outputs_schema: schemas/output.json
tests: evals/
```

Skill 是“可复用程序化知识”，不是另一个拥有无限权限的 Agent。

### 7.2 生命周期

```text
draft -> validating -> active -> deprecated
             |             |
             v             v
           rejected      rollback
```

- 用户创建或 Agent 建议的新 Skill 默认 `draft`
- 激活前验证工具依赖、静态扫描、沙箱测试和评测样例
- Skill 更新生成新版本，不原地修改生产版本
- 评测回退或安全策略变化时自动回滚/禁用

### 7.3 从经验生成 Skill

本阶段只生成候选：当相似任务成功完成至少 3 次，系统提出“保存为 Skill”，给出步骤、参数化位置、所需工具和风险。必须由用户确认后进入验证流程。

---

## 8. 主动自动化

### 8.1 Scheduler

动态计划保存在数据库，不使用写死在 Worker 配置中的 cron：

- Scheduler 每 10 秒获取 due trigger
- 使用 PostgreSQL advisory lock 或 `FOR UPDATE SKIP LOCKED` 防多实例重复触发
- 计算下一次运行时使用用户时区和 DST 规则
- 每次触发生成唯一 idempotency key
- 实际任务仍创建标准 Agent Run，继承预算、审批和审计

### 8.2 触发类型

- 一次性时间：提醒、未来执行
- Cron：日报、周报、定期整理
- Webhook：第三方系统事件
- Connector Event：新邮件、日历变化、GitHub 事件等，Phase 9 扩展

### 8.3 离线与审批

- 云端工具任务可在用户离线时继续
- 需要桌面节点或审批时进入等待，不判定失败
- 自动化的审批请求必须通过 Push/Email/In-app 通知
- 超过等待期限后按策略取消，不得自动降级为更高权限

等待、审批与恰好一次完成语义直接复用 Phase 5/6 已交付的机制：Agent Run 状态机、审批
payload hash fail-closed 校验、执行节点投递/ACK 与结果 spool 重放。本阶段只新增触发器类型、
等待期限策略和通知渠道，不重复实现执行语义。

---

## 9. 用户体验

### 9.1 记忆中心

- 分类查看“关于我、偏好、人物与关系、过去任务”
- 搜索、编辑、确认候选、拒绝、过期、导出和删除
- 每条记忆显示来源、首次/最后使用时间、敏感级别和存储位置
- 提供全局暂停记忆、按类型关闭和清空全部

### 9.2 知识库

- 创建生活、学习、工作或项目知识库
- 上传/连接来源，展示同步状态、失败原因和版本
- 用“测试检索”查看某问题命中了哪些原文
- 支持空间级权限，不把所有资料注入每个对话

### 9.3 Skills

- 已安装、系统内置、我创建的、待确认候选四个视图
- 展示所需工具、数据访问、风险上限、评测结果和版本
- 启用范围：全局、指定助理或指定空间

### 9.4 自动化

- 自然语言创建后必须转为明确的时间、时区、目标和预算供用户确认
- 列表展示下次运行、最近结果、失败次数和等待审批状态
- 支持暂停、立即运行、编辑、复制、查看历史和删除

---

## 10. API

- `/memories`：查询、候选确认、编辑、删除、导出
- `/knowledge-bases`：CRUD、成员和策略
- `/knowledge-sources`：连接、同步、暂停、重新摄取
- `/knowledge-documents`：状态、版本和来源定位
- `/skills`：目录、版本、验证、启用和回滚
- `/automations`：CRUD、暂停、立即运行和历史
- `/webhooks/{public_id}`：签名事件入口，与普通用户 API 隔离

所有列表使用 cursor 分页；删除和导出为异步 Job 时返回 202。

---

## 11. 测试与评测

### 11.1 记忆测试

- 去重、冲突、过期、supersede 和彻底删除
- 敏感信息默认不自动激活
- 本地记忆在节点离线时不泄漏到云端
- 用户 A 的记忆和知识 Chunk 不会被用户 B 召回
- Prompt injection 文档不能改变 Agent 策略

### 11.2 检索评测

建立带期望来源的测试集，跟踪：Recall@K、MRR、引用准确率、无答案拒答率、跨空间误召回率。不能只测试接口 200。

### 11.3 Skills 测试

- manifest schema、工具版本、风险上限和静态扫描
- Skill 成功率、成本、平均 Step、错误恢复和输出 schema
- 新版本不通过评测时不得替换 active 版本

### 11.4 自动化测试

- 时区、DST、重复触发、Worker 崩溃和 idempotency
- 需要审批/桌面节点时正确等待并通知
- Webhook 签名、重放保护、限流和畸形 payload

### 11.5 环境与门禁

Phase 5/6 收尾期间真实发生过的本地与 CI 环境差异，必须在本阶段开工时纳入验收，而不是合并期才暴露：

- 全部验收以远程 CI（Frontend / Web E2E smoke / Backend）全绿为准，不依赖开发者本地环境
- 测试环境的密钥与连接配置一律由 `tests/conftest.py` 提供；任何测试不得假设 `backend/.env` 存在
- 沙箱类用例依赖系统 bubblewrap：CI 已安装并放开非特权 userns；新增沙箱能力时同步维护该 CI 步骤
- Web E2E 以全量用例（Chromium + Mobile Safari）为口径；WebKit 引擎限制（例如 route.fulfill 的附件响应不触发 download 事件）在用例内显式分流并注明原因
- `pnpm-lock.yaml` 有变更时必须先通过 `pnpm install --frozen-lockfile` 验证再提交，防止合并损坏锁文件

---

## 12. 验收标准

- [ ] 用户能查看、修改、拒绝和彻底删除 Agent 记忆
- [ ] Agent 能正确使用用户偏好，但不会把一次临时要求永久记住
- [ ] 知识回答具备可回到原文的引用，跨用户/空间隔离测试通过
- [ ] 成功任务可保存为待验证 Skill，新版本可回滚
- [ ] 用户可创建跨时区定时任务，离线时云端正常运行
- [ ] 自动化需要审批或本机资源时会等待并通知，不会越权
- [ ] pgvector + FTS 混合检索达到项目设定的离线评测阈值
- [ ] 记忆、知识和 Skills 的敏感内容不会进入普通日志/trace
- [ ] 上述验收在远程 CI 全绿达成，测试不依赖开发者本地 .env 或手工环境

**进入 Phase 8 的许可证**：记忆删除、知识 ACL、Skill 版本回滚和定时任务幂等四类关键集成测试全部通过。
