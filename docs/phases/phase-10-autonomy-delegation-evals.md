# Phase 10 - 高级自治、任务委派、自我改进与 Agent 评测

- **前置条件**：Phase 9 跨连接器真实场景达到稳定成功率，治理和预算体系已生产验证
- **建议分支**：`feat/phase-10-autonomy`
- **执行范围**：Agent Runtime、评测平台、子 Agent/脚本委派、Skill 生命周期和高级执行 UI
- **阶段定位**：提升复杂任务完成率和自治时长，但不以“更多 Agent 数量”作为产品价值

---

## 1. 产品原则

### 1.1 用户面对的是一个助理

研究员、执行者、审查者等角色是内部执行策略。除非解释任务进度确有必要，用户不需要管理一组人格化 Agent，也不需要决定它们如何通信。

### 1.2 自治必须逐级毕业

| 等级        | 能力                               | 默认发布状态   |
| ----------- | ---------------------------------- | -------------- |
| L0 回答     | 只生成文本                         | 已有聊天       |
| L1 建议     | 给计划和草稿，不执行               | 已有/Phase 5   |
| L2 监督执行 | 使用工具，高风险动作审批           | Phase 6-9 默认 |
| L3 有界自治 | 在明确目标、预算、作用域内持续执行 | 本阶段目标     |
| L4 主动经营 | 根据长期目标发现问题并发起任务     | Phase 11 灰度  |
| L5 无界自治 | 自行设定目标、扩权和消费           | 明确不支持     |

### 1.3 先评测，后放权

任何 Skill、工具组合或自动化只有在离线评测、沙箱回放和小流量灰度达到阈值后，才能获得更高自治等级。

---

## 2. Planner / Executor / Reviewer

```text
Goal
 -> Planner：形成可验证计划和成功标准
 -> Executor：逐步执行，可调用工具或委派子任务
 -> Reviewer：检查事实、产物、测试与成功标准
 -> 修正（有界次数）或 Final
```

### 2.1 Planner

- 只在复杂任务启用；简单任务继续使用 Phase 5 单循环
- 计划节点必须包含输入、工具需求、成功条件、风险和依赖
- 计划不是不可变剧本，执行结果变化时可生成新 revision
- 每次 replan 记录原因，默认最多 3 次

### 2.2 Executor

- 同一 Run 可并发执行无依赖、只读且预算允许的步骤
- 有副作用步骤默认串行，确保审批和幂等顺序
- 子任务只获得最小上下文和能力，不继承父 Run 全部 Secret/工具

### 2.3 Reviewer

Reviewer 不只是另一个“感觉不错”的模型：

- 文档：引用、事实一致性、要求覆盖、敏感信息
- 数据：公式、单位、总计、异常值和可复现代码
- 代码：测试、lint、typecheck、diff 范围和安全扫描
- 外部动作：目标对象、收件人、影响范围和可撤销性
- 任务：逐条对照用户成功标准

能由确定性工具验证的内容必须优先用工具，不用 LLM 猜测。

---

## 3. 子 Agent 委派

### 3.1 `agent_subruns`

子任务仍是标准 AgentRun，通过 `parent_run_id` 和 `delegation_contract` 关联：

- 目标和明确输出 schema
- 最大 Step、token、成本、时间和并发
- 允许工具、连接和数据范围
- 是否允许继续委派（默认否）
- 结果验证器

父 Run 不接收子 Run 全部思考历史，只接收结构化结果、引用、Artifact、错误和使用量。

### 3.2 并发限制

- 普通用户默认最多 3 个并发子 Run
- 单一父 Run 默认最多 5 个子 Run
- 委派深度默认 1，硬上限 2
- 总预算由父 Run 预留，子 Run 不能各自突破总上限
- 任一子 Run 请求高风险审批时，回到父 Run 聚合展示

### 3.3 适用场景

- 多来源并行研究
- 多文件独立分析后汇总
- 多方案生成与评审
- 跨平台状态采集
- 大型代码库中相互独立的检查

不适用：简单顺序任务、共享可变状态、强副作用流程。

---

## 4. 脚本化委派

参考 Hermes 的“代码调用工具”思路，为高频稳定流程提供受控 Agent Script：

```python
from yuanai_agent import tools, artifact

results = await tools.map(
    "yuanai.web.extract",
    [{"url": url} for url in inputs.urls],
    concurrency=3,
)
await artifact.write_json("sources.json", results)
```

限制：

- Script 运行在 Phase 6 沙箱，不在 Coordinator 进程
- 只能调用 delegation contract 允许的工具
- RPC 层继续执行 PolicyEngine、预算、审批和审计
- 代码由平台模板、已审核 Skill 或用户显式提供；模型生成脚本首次运行必须沙箱预检
- 禁止脚本直接访问 SecretStore、数据库和内部网络

脚本化的目标是降低大量工具调用的模型上下文成本，不是绕过 Agent 控制面。

---

## 5. 自我改进闭环

### 5.1 信号

- Run 成功/失败和失败分类
- 用户编辑计划、草稿和最终产物的差异
- 审批拒绝原因
- Tool 重试、循环、超时和连接器错误
- 用户显式评分和“以后这样做”反馈
- Reviewer 与确定性验证结果

### 5.2 可自动产生的候选

- 用户偏好候选
- Skill 新版本候选
- Prompt/Context 策略实验候选
- 工具参数模板和恢复策略候选
- 场景模板改进建议

### 5.3 不允许自动改变

- 平台安全策略和风险等级
- 工具/连接权限和审批范围
- Secret、预算硬上限和数据位置
- 已发布 Skill 的 active 版本
- 用户未明确授权的长期目标

### 5.4 Skill 晋级

```text
候选生成
 -> 静态/安全检查
 -> 离线回放
 -> Golden Task 评测
 -> Shadow 模式（不产生副作用）
 -> 小流量灰度
 -> 用户/运营确认
 -> Active
```

任何阶段失败都保留旧版本并记录回退原因。

---

## 6. Agent Eval 平台

### 6.1 测试集类型

- Unit Tasks：单工具选择、参数和错误处理
- Scenario Tasks：生活、学习、工作完整旅程
- Safety Tasks：注入、越权、数据外传、破坏性动作
- Robustness Tasks：超时、限流、断线、网页变化和部分失败
- Long-horizon Tasks：20+ Step、跨小时、等待审批/节点
- Personalization Tasks：正确使用记忆且不泄露其他空间信息

### 6.2 指标

| 维度 | 指标                                                       |
| ---- | ---------------------------------------------------------- |
| 完成 | success rate、success criteria coverage                    |
| 正确 | factuality、citation precision、deterministic checks       |
| 工具 | selection、argument validity、unnecessary calls、loop rate |
| 安全 | policy violation、unapproved side effect、data leakage     |
| 效率 | steps、tokens、cost、latency、parallel efficiency          |
| 体验 | approval count、clarification quality、user edits          |
| 稳定 | retry recovery、resume success、provider variance          |

### 6.3 Judge 策略

- 确定性断言优先
- LLM-as-judge 必须多维 rubric、固定版本和抽样人工校准
- 高风险安全结论不能只依赖 LLM judge
- 每个结果保存模型、prompt、工具和数据集版本
- 防止训练/优化直接看到私有评测集答案

### 6.4 回归门禁

- 核心成功率下降超过阈值，禁止发布
- 任一高危安全用例失败，禁止发布
- 成本/时延显著回退需显式批准
- 模型或 Provider 切换必须跑 capability-specific suite

---

## 7. Shadow 与 Simulation

### 7.1 Shadow Run

在不产生外部副作用的条件下，用新策略重放脱敏任务：

- 写操作进入模拟 ToolExecutor
- 比较计划、工具选择、结果质量和成本
- 不向用户显示、不写真实记忆、不触发通知
- 用户敏感内容只在授权的同区域环境处理

### 7.2 Digital Sandbox

为 Calendar、Email、GitHub、任务系统提供测试账户/模拟服务器，验证复杂工作流和回滚。不能用生产用户账号做自动回归。

---

## 8. 长时任务

### 8.1 Checkpoint

每个 Step、外部事件和审批后写 checkpoint：

- 当前计划 revision
- 已完成节点与 Artifact
- 未决审批/人工动作
- 工具幂等键与外部对象 ID
- 剩余预算和 deadline

模型上下文可重新构建，不序列化 SDK 运行时对象。

### 8.2 何时引入 Temporal

达到以下任一条件时启动正式技术评估：

- 大量任务跨天并包含多个计时器/外部 Signal
- 多服务补偿事务无法由当前状态机安全表达
- Worker/区域迁移导致自研恢复逻辑复杂度显著上升
- Run 量和租约扫描成为数据库瓶颈

即使采用 Temporal，AgentRun/Step/Event 仍是产品真相源，Temporal workflow ID 作为执行引用。

---

## 9. 预算与资源调度

- Planner 在执行前给出估算，复杂任务预留总预算
- Coordinator 按 Step 实时扣减，不信任模型自报
- 并行任务采用 token bucket，防止瞬时成本放大
- 对价值低或重复的探索步骤进行早停
- 用户可选择“更快 / 平衡 / 更省”，映射为策略而非单纯换模型
- 系统不得为完成低价值任务自动升级到昂贵模型而不显示

---

## 10. 用户体验

### 10.1 执行视图

- 默认显示目标、当前阶段、关键进展、等待项和交付物
- 内部子 Agent 以任务分支展示，不模拟多人聊天气泡
- 可展开查看工具、来源、成本和 Reviewer 结论
- 用户可在运行中追加约束；Coordinator 在安全边界重规划

### 10.2 自主设置

按空间和能力设置：

- 允许自动读取的数据
- 允许自动产生的本地草稿
- 必须确认的外部动作
- 单次/每日预算和最长运行时间
- 主动任务范围和通知预算

不提供一个含义模糊的“完全自主”总开关。

### 10.3 复盘

复杂 Run 完成后提供简洁复盘：完成了什么、改变了什么、使用哪些数据、花费、未完成项、学到的候选记忆/Skill。

---

## 11. 数据模型增量

- `run_plans` / `run_plan_revisions`
- `run_plan_nodes` / `run_plan_edges`
- `delegation_contracts`
- `eval_datasets` / `eval_cases` / `eval_runs` / `eval_results`
- `strategy_versions` / `strategy_experiments`
- `skill_promotion_runs`
- `user_feedback_events`

评测数据和生产用户数据分库/分 schema 管理；未经授权不得将生产内容自动加入共享评测集。

---

## 12. 测试要求

- Planner 计划 schema、依赖环和 replan 上限
- 并发子 Run 的预算、取消和审批聚合
- 子 Agent 无法访问 contract 外的工具/记忆/连接
- Script RPC 不能绕过策略和 SecretStore
- Reviewer 使用确定性验证器时正确判定
- 长时 Run 重启、跨版本恢复和 checkpoint 迁移
- Skill 候选不能直接替换 active 版本
- Shadow Run 不产生真实副作用、通知或记忆
- Eval 数据版本与结果可复现

---

## 13. 验收标准

- [ ] 复杂研究任务能并行委派、汇总并保留引用
- [ ] 子 Run 权限、预算和上下文均严格小于等于父 Run
- [ ] Reviewer 能发现预设的事实、计算、测试和权限错误
- [ ] 20+ Step 长时任务在进程/节点重启后恢复
- [ ] 新 Skill 必须经过评测、Shadow 和灰度才能生效
- [ ] 高危安全评测失败会自动阻断发布
- [ ] 相比 Phase 9 基线，复杂任务成功率提升且成本处于阈值内
- [ ] 用户看到的是清晰任务进展，而非难以理解的多 Agent 对话

**进入 Phase 11 的许可证**：L3 有界自治通过长时任务、安全、成本和真实用户评测；系统证明能够可靠执行用户设定的长期目标，但不会自行扩权或设定无关目标。
