# Phase 17 - 多 Agent 协作与调度

- **前置条件**：[Phase 10](./phase-10-autonomy-delegation-evals.md) 子 Agent 委派、评测平台与预算调度已生产验证
- **建议分支**：`feat/phase-17-multi-agent`
- **执行范围**：协作对象模型（Board / Task / Link / Commit）、六种协作模式、调度器、委派 Profile
- **阶段定位**：把 Phase 10 的「一父多子」委派扩展成**可观察、可恢复、可人工介入**的协作结构

---

## 1. 产品目标

1. 复杂目标能被拆成有明确依赖关系的 Task，并行执行、汇总验收，中途崩溃可恢复
2. 协作过程有**单一可读状态**（Board），而不是散落在各个子 Run 的日志里
3. 子 Agent 的能力边界由**可复用的 Profile**声明，而不是每次手写 contract
4. 调度器对并发、预算、公平性和抢占有明确策略，不靠「同时起几个」碰运气

### 1.1 非目标（继承 Phase 10，本阶段不改）

- **不模拟多人聊天气泡**：用户看到的仍是一个助理和一份任务进展（Phase 10 §10.1 / §13）
- **不以「更多 Agent 数量」作为产品价值**（Phase 10 阶段定位）
- 不提供用户可见的「Agent 群聊」「圆桌讨论」形态
- 不让子 Agent 互相授予权限或自行扩大 contract（Phase 10 §3）
- 不实现可视化工作流编辑器：Board 是**运行时状态视图**，不是编辑器
- 不引入新的工作流引擎；是否引入 Temporal 仍按 Phase 10 §8.2 的条件评估

> 本阶段补的是协作的**机制与可观测性**，不是协作的**拟人化表演**。
> 任何让界面看起来像多人聊天的设计都不在范围内。

---

## 2. 核心概念

### 2.1 四个对象

| 对象       | 含义                                             | 与既有模型的关系                        |
| ---------- | ------------------------------------------------ | --------------------------------------- |
| **Board**  | 一个目标的协作边界：共享状态、预算、权限和时间线 | 一个 Board 对应一个顶层 `AgentRun`      |
| **Task**   | 可领取、可执行、可验收的工作单元                 | 扩展 `run_plan_nodes` + `agent_subruns` |
| **Link**   | Task 之间的关系                                  | 扩展 `run_plan_edges`，补上关系类型     |
| **Commit** | Task 对 Board 共享状态的**原子提交**，带证据     | **本阶段新增**，Phase 10 没有对应物     |

Board / Task / Link 都是在既有计划图模型上**加语义**，不另起一套执行体系。
Commit 是真正的新东西，下面单列。

### 2.2 Board

- 持有：目标、共享状态（Artifact 与结论）、总预算、权限上限、deadline、Journal
- **权限与预算是上限而非配额之和**：所有 Task 的实际消耗合并受 Board 上限约束，
  避免「每个子任务都在自己预算内，总花费却失控」
- Board 状态机：`planning → running → waiting_human → reviewing → done / failed / cancelled`
- 一个 Board 的共享状态只能通过 Commit 改变，不允许 Task 直接写

### 2.3 Task

- 字段：目标、输入、验收条件、Profile、预算、`max_steps`、deadline、幂等键
- 状态机：`pending → claimable → claimed → running → committed → accepted / rejected`
- `rejected` 后按 Link 上声明的策略重试或整体失败，重试次数有硬上限
- Task 执行体仍是标准 `AgentRun`（Phase 10 §3），本阶段不新增第二种执行器

### 2.4 Link

| 类型           | 语义                                       |
| -------------- | ------------------------------------------ |
| `depends_on`   | 前置 Task 到达 `accepted` 后本 Task 才可领 |
| `consumes`     | 本 Task 消费前置 Task 的 Commit 产物       |
| `reviews`      | 本 Task 负责验收另一个 Task 的 Commit      |
| `blocks_human` | 本 Task 需要人工动作才能继续               |

- 建图时**必须检测环**，有环即计划非法，不进入执行（沿用 Phase 10 §12 依赖环要求）
- `reviews` 的 Task 不能复核自己，也不能由同一 Profile 的同一次调用兼任

### 2.5 Commit

Commit 是 Task 向 Board 交付结果的**唯一通道**，这是本阶段最关键的约束。

```text
Task 执行完成
 -> 生成 Commit（Artifact + 证据 + 自评）
 -> reviews Task 或确定性验证器验收
 -> accepted 则原子写入 Board 共享状态
 -> rejected 则 Board 状态不变，按 Link 策略处置
```

- Commit 是**原子的**：要么共享状态全量生效，要么完全不生效，不留半截结果
- Commit 必须带证据：工具调用 ID、来源引用、产出 Artifact ID；没有证据的 Commit 直接拒收
- Commit 不可变；修正通过新 Commit，不原地改写（否则 Journal 失去可信性）
- 外部副作用（发消息、写外部系统）**在 Commit 被 accepted 之后**才执行，并使用 Task 的幂等键。
  先产生副作用再等验收会让 rejected 无法回退

---

## 3. 协作模式

六种模式都是 Board / Task / Link 的**组合**，不是六套独立机制。

### 3.1 fan-out

一个 Task 展开为 N 个同构并行 Task。

- 调度：N 受 Board 并发上限与调度器 token bucket 双重约束（Phase 10 §9）
- 失败语义：按声明取 `all`（任一失败即整体失败）或 `quorum`（达到比例即继续）
- 预算：展开前必须能给出 N 的上界；上界不可知的展开一律拒绝，防止预算放大

### 3.2 fan-in

N 个 Task 的 Commit 汇聚为一个 Task 的输入。

- 汇聚 Task 看到的是**已 accepted 的 Commit 集合**，不是各子 Run 的原始日志
- 必须处理部分失败：缺失项要显式呈现为「缺这几项」，不静默按剩余项下结论
- 汇总结论必须保留各来源引用，可追溯到具体 Commit

### 3.3 pipeline

Task 以 `consumes` 串成流水线。

- 每级只看上一级的 Commit 产物，不继承其完整上下文（上下文随级递减，不随级累积）
- 任一级 rejected 时停在该级，已 accepted 的前置状态保留，重跑从该级开始
- 适用于「抓取 → 清洗 → 分析 → 成稿」这类阶段清晰的任务

### 3.4 long-running journal

跨天、跨进程的长任务用 Journal 承载连续性。

- Journal 是 Board 上**append-only** 的事件流：Commit、审批、外部 Signal、重规划、预算变动
- 恢复时从 Journal 重建模型上下文，与 Phase 10 §8.1 checkpoint 配合：
  checkpoint 给「当前状态」，Journal 给「怎么走到这」
- Journal 条目**不可删除**；敏感内容按 Phase 7 §11.5 的脱敏规则写入，而不是事后删
- 用户可读 Journal：它同时是复盘材料（Phase 10 §10.3）

### 3.5 human-in-the-loop

人工介入是**一等协作参与方**，不是异常分支。

- `blocks_human` Link 把人工动作建模成 Task：有负责人、有 deadline、有超时策略
- 等待期间 Board 进入 `waiting_human`，**不占用执行并发**，预算计时暂停
- 超时策略三选一：继续（按声明的保守默认）、降级（缩小范围）、放弃；没有「永久等待」
- 审批请求通过既有渠道送达（Phase 12 §7.5 渠道内审批），不新建通知体系

### 3.6 fleet farming

对大批同构工作项（如「处理这 500 份文件」）的持续产出模式。

- 工作项进**持久队列**，不一次性展开成 500 个 Task
- 固定规模的 worker Task 池按租约领取，失败项进重试队列并有死信上限
- **必须先在小样本上跑通并通过验收**，再放开规模；放开规模要显式确认（含预计成本）
- 单位成本与成功率实时可见；成功率跌破阈值自动暂停，不烧完预算才停

---

## 4. 调度器

### 4.1 职责

本阶段的调度器负责**哪个 Task 现在可以跑**，与 `automation_scheduler.py`（定时触发自动化）
是两件事，不要合并：前者调度 Board 内的 Task，后者按时间触发 Run。

- 计算可领取集合（依赖已满足 + 预算充足 + 并发未满）
- 分配租约并在租约到期后回收，避免崩溃的 worker 永久占位
- 执行优先级与公平性策略
- 在 Board 预算或 deadline 耗尽时统一停止

### 4.2 策略

- **优先级**：阻塞最多后继的 Task 优先（关键路径优先），同级按创建时间
- **公平性**：单个用户 / 单个 Board 占用的全局并发有上限，防止一个 Board 饿死其他人
- **抢占**：只抢占可安全中断的 Task（无未提交外部副作用）；执行中的外部动作不抢占
- **预算**：沿用 Phase 10 §9 的 token bucket；Board 预算耗尽时停止派发新 Task，
  已 running 的 Task 允许完成当前 Step 后收尾
- **退避**：同一 Task 连续失败按指数退避，避免对同一失败点高频重试

### 4.3 可恢复性

- 租约过期的 Task 回到 `claimable`，幂等键保证重复执行不产生重复外部副作用
- 调度器自身无状态：可领取集合从数据库实时计算，重启不丢调度意图
- 所有调度决策写 Journal，「为什么这个 Task 一直没跑」可以被回答

---

## 5. 委派 Profile

### 5.1 Profile 与 Contract 的关系

- **Profile 是模板**：工具白名单、风险上限、模型、单次预算、上下文配额、系统提示片段
- **`delegation_contract` 是实例**（Phase 10 §3.1）：由 Profile 加本次 Task 的具体参数生成
- 实例化时取**交集**：Profile 声明的权限与父 Run 的权限取小，永不取大

### 5.2 内置 Profile

| Profile      | 用途         | 典型边界                             |
| ------------ | ------------ | ------------------------------------ |
| `researcher` | 检索与取证   | 只读工具；必须带来源；禁止写外部系统 |
| `writer`     | 成稿         | 无网络；只消费上游 Commit            |
| `reviewer`   | 验收         | 只读；不能修改被审对象               |
| `operator`   | 执行外部动作 | 工具按任务显式列举；高风险必过审批   |

用户可基于内置 Profile 派生，但派生只能收紧。

### 5.3 约束

- Profile **不能提权**：不能提高风险上限、不能添加父 Run 没有的工具、不能扩大记忆范围
- Profile 不含凭据，只含 SecretStore 引用
- 委派深度仍受 Phase 10 §3「默认 1、硬上限 2」约束；Profile 不能改这个上限
- Profile 变更生成新版本；运行中的 Task 继续使用其启动时的版本

---

## 6. 数据模型增量

- `boards`：目标、状态、预算上限、权限上限、deadline
- `board_tasks`：Task 定义与状态、Profile 版本、幂等键、重试计数
- `board_links`：关系类型与失败策略
- `board_commits`：产物、证据引用、自评、验收结果（不可变）
- `board_journal`：append-only 事件流
- `delegation_profiles` / `delegation_profile_versions`
- `task_leases`：租约持有者与到期时间
- `fleet_queues` / `fleet_items`：fleet farming 的工作项与死信

`board_commits` 与 `board_journal` 禁止 `UPDATE` / `DELETE`，在 schema 层约束，不靠代码自觉。

---

## 7. API

| 方法与路径                      | 说明                             |
| ------------------------------- | -------------------------------- |
| `POST /boards`                  | 创建 Board（目标 + 预算 + 权限） |
| `GET /boards/{id}`              | Board 状态、Task 图与进展        |
| `GET /boards/{id}/journal`      | Journal 分页读取                 |
| `POST /boards/{id}/tasks`       | 追加 Task 与 Link                |
| `POST /tasks/{id}/commit`       | 提交 Commit（内部调用）          |
| `POST /commits/{id}/review`     | 验收结果                         |
| `POST /tasks/{id}/human-action` | 人工动作完成回执                 |
| `GET/POST /delegation-profiles` | Profile 管理                     |
| `POST /boards/{id}/fleet/scale` | 放开 fleet 规模（显式确认成本）  |

Board 事件经既有 SSE/WSS 通道推送，不新建实时通道。新增/变更接口同步更新 `packages/types`。

---

## 8. 用户体验

严格沿用 Phase 10 §10.1：**任务分支视图，不是聊天视图**。

- 默认一屏：目标、当前阶段、已完成/进行中/等待项、交付物、已花费与剩余预算
- Task 图默认折叠为阶段进度条；展开才显示依赖图
- 每个交付物可点进去看 Commit 的证据链（工具调用、来源、Artifact）
- 等待人工的项置顶，写清「需要你做什么」「超时会怎样」
- fleet farming 显示：已处理 / 总数、成功率、单位成本、暂停阈值
- **不显示** Agent 名字、头像、对话气泡或「Agent A 对 Agent B 说」

---

## 9. 可观测

- 指标：Board 完成率与时长分布、Task 重试率、Commit 拒收率、租约过期率、
  调度等待时长、人工等待时长、fleet 单位成本与成功率
- 每个 Board 可导出一份执行报告（Journal + Commit 证据），用于复盘与评测集构建
- 调度决策、Commit 验收与预算拦截全部可审计

---

## 10. 测试要求

- 有环的计划图被拒绝执行
- `reviews` Task 不能复核自己
- Commit 原子性：验收失败时 Board 共享状态完全不变
- 无证据的 Commit 被拒收
- 外部副作用只在 accepted 之后发生，且幂等键阻止重复执行
- fan-out 上界不可知时拒绝展开
- fan-in 部分失败时显式呈现缺失项，不按剩余项静默下结论
- pipeline 中间级 rejected 时，已 accepted 的前置状态保留且重跑从该级开始
- Journal 的 `UPDATE` / `DELETE` 在数据库层被拒绝
- `waiting_human` 不占用执行并发，且预算计时暂停
- 人工超时按声明策略处置，不存在永久等待路径
- 租约过期后 Task 可被重新领取且不产生重复副作用
- Board 预算耗尽后不再派发新 Task
- 单 Board 并发上限生效，不会饿死其他 Board
- Profile 实例化为 contract 时权限取交集，任何提权尝试失败（逐条用例）
- 运行中 Task 不受 Profile 新版本影响
- fleet 成功率跌破阈值自动暂停
- 跨进程重启后 Board 从 Journal + checkpoint 恢复，Task 不重复执行

---

## 11. 验收标准

- [ ] 一个真实复杂目标走完 fan-out → fan-in → 验收，结论可追溯到每个 Commit 的证据
- [ ] pipeline 任务在中间级失败后从该级重跑，前置结果未重算
- [ ] 跨天长任务经进程重启后继续，Journal 可读且连续
- [ ] 人工介入项有负责人、deadline 和超时行为，无永久等待
- [ ] fleet farming 先小样本验收再放量，成功率跌破阈值自动暂停
- [ ] 子 Agent 权限、预算、上下文均严格小于等于父 Run（有逐条用例）
- [ ] Commit 原子性与不可变性有 schema 级证据
- [ ] 界面上不出现任何多 Agent 对话形态，用户只看到一份任务进展
- [ ] 相比 Phase 10 基线，复杂任务成功率提升且单位成本未恶化

**进入下一阶段的许可证**：协作结构可恢复、可审计、可人工介入；Commit 是共享状态的唯一入口
且不可变；权限与预算在任何协作模式下都只收紧不放大。
