# 专属助手人格（Persona）设计

> 对应 [MASTER_PLAN](../../master-plan.md) **M6**（主线）与 **M12**（前置，本轮做后端半边 + Web 全量），
> 顺带 **S27 / S16 / S18 / S3**。阶段设计见
> [Phase 7 §3.6 / §8.5](../../phases/phase-7-memory-skills-automation.md)。
>
> **日期**：2026-10-07 · **分支**：`feature/assistant-persona` · **基线**：`dev`

---

## 1. 为什么做

Phase 7 §8.5 要的是「用户拥有自己的那一个助理」，而不是一个无差别的通用机器人。
当前仓库里这件事一处都没落地，并且有两个比「缺功能」更严重的前提问题：

| 问题                                                                      | 证据                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **主聊天链路一条 system 消息都没有**，助理配置对日常聊天完全不生效        | `services/chat_service.py:43` `build_openai_messages(history, files)`          |
| **三端零处调用 `createAssistant`**，新用户助理列表恒空，五个控制面全瘫    | `packages/core/src/api/agent.ts:50` 有导出，`apps/*` 零调用（M12）             |
| `memories.assistant_id` 是 `nullable=False`，与 §8.5.3「为空=用户级」冲突 | `models/memory.py:95`                                                          |
| 桌面端与移动端连 Agent 界面都没有                                         | `apps/mobile/app` 零个 agent 路由、`apps/desktop/src/renderer` 零个 agent 组件 |

已经成立、本轮要复用而不是重写的：

- Agent 链路**已有**助理指令消费点：`workers/agent_worker.py:113` → `coordinator` →
  `services/agent/policy.py:39 build_system_messages()`
- 跨助理记忆隔离**已经成立**：`services/memory_retrieval.py:38 accessible_filters()` 是检索的
  **唯一**过滤出口，三条臂（关键词、向量、分页导出）都经过它
- 一人一默认助理的唯一索引已存在：`uq_assistants_user_default`

## 2. 目标与非目标

**目标**

1. 人格可编辑、可预览、可版本回滚，并在**主聊天与 Agent 两条链路**一致生效
2. 人格**不提权**：只影响表达方式，不能放宽安全与拒绝边界
3. 新用户开箱即有助理（关掉 M12 的后端半边），Web 可建第二个助理
4. 记忆支持「用户级共享 / 助理私有」两级，并可互相提升降级
5. 用户纠正表达方式时沉淀为**人格候选项**，确认后才生效

**非目标**

- 不做虚构人物扮演、恋爱陪伴人设模板（§8.5.2）
- 不做形象与音色（归 Phase 11 §6.5）
- 不做桌面/移动端的助理增删改与人格编辑器（归下轮 S14，见 §11）

## 3. 本轮决策记录

用户 2026-10-07 逐项拍定：

| #   | 决策           | 选择                                            |
| --- | -------------- | ----------------------------------------------- |
| D1  | 人格生效链路   | **Agent Run + 主聊天**                          |
| D2  | M12 范围       | 后端自动建默认助理 + **Web 全量增删改**         |
| D3  | 用户级记忆     | **本轮一起做**（`assistant_id` 改 nullable）    |
| D4  | 人格编辑器预览 | **展示拼好的人格提示词**，不调模型              |
| D5  | §8.5.5 候选项  | **本轮一起做**                                  |
| D6  | 桌面/移动端    | **只做「当前助理标签 + 切换器」**，增删改归下轮 |
| D7  | 顺带小任务     | S27、S16、S18、S3                               |

D6 的理由：人格生效在后端，所以桌面/移动端**自动**拿到人格，§8.5.1「多端一致」由后端保证；
这两端唯一真正缺的是「知道在跟哪个助理说话」—— 用户在 Web 建了第二个助理后，
不补这一项就会在无提示的情况下跟某个助理对话，正是 §8.5.6 点名要避免的。

## 4. 数据模型

一个 Alembic 迁移，3 张新表 + 2 处列变更。

### 4.1 `assistant_personas`（当前生效人格，一对一于 assistant）

| 列                          | 类型                                         | 说明                     |
| --------------------------- | -------------------------------------------- | ------------------------ |
| `id`                        | UUID PK                                      |                          |
| `assistant_id`              | UUID FK → `assistants.id` CASCADE **UNIQUE** | 一对一                   |
| `address_user`              | String(40)                                   | 怎么称呼用户             |
| `self_name`                 | String(40)                                   | 自称                     |
| `tone`                      | Enum `concise/patient/lively/rigorous`       | 语气                     |
| `verbosity`                 | Enum `brief/balanced/detailed`               | 回答长度偏好             |
| `greeting`                  | Text                                         | 开场白                   |
| `refusal_style`             | Text                                         | 拒绝与不确定时的表达方式 |
| `forbidden_topics`          | JSON `list[str]`                             | 禁止话题                 |
| `language`                  | String(16)                                   | 语言与称呼习惯           |
| `version`                   | Integer                                      | 当前版本号，从 1 起      |
| `created_at` / `updated_at` | timestamptz                                  |                          |

### 4.2 `assistant_persona_versions`（快照，回滚与追溯用）

`id`、`assistant_id` FK CASCADE、`version` Integer、`payload` JSON（人格全量快照）、
`change_reason` String(64)、`created_at`（= 生效时间）。
`UNIQUE(assistant_id, version)`。

`change_reason` 取值：`manual` / `candidate:{candidate_id}` / `rollback:{from_version}`。
这一列就是 §8.5.1「用户随时能看到它为什么这样说话」的数据面。

**回滚语义**：回滚到版本 N 是「取 N 的 `payload` 生成一个**新**版本」，
版本号继续递增、不复用旧号，`change_reason=rollback:N`。
不这么定会撞 `UNIQUE(assistant_id, version)`，而且会抹掉回滚这个动作本身的历史。

### 4.3 `persona_candidates`（§8.5.5）

`id`、`user_id`、`assistant_id` FK CASCADE、`field`（人格字段名）、`suggested_value` Text、
`evidence` Text（用户原话摘录）、`source_type` Enum `run/chat`、`source_id` UUID nullable、
`status` Enum `pending/accepted/rejected`、`created_at`、`decided_at` nullable。

### 4.4 列变更

| 变更                                                                    | 原因                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 新增 `conversations.assistant_id` UUID FK nullable，`ondelete=SET NULL` | 主聊天要知道这条会话属于哪个助理；助理被删时会话保留并退回默认 |
| `memories.assistant_id` `nullable=False` → `True`                       | `NULL` = 用户级共享记忆（§8.5.3）                              |

`memories.assistant_id` 的 FK 已是 `ondelete=CASCADE`，`NULL` 行不受级联影响，
因此「删除助理时私有记忆一并删除、用户级不受影响」无需额外代码。

## 5. 人格片段装配

新增 `backend/app/services/persona_service.py`，**两条链路共用一份**，是截断规则的单一真源。

```
build_persona_fragment(persona) -> str
```

- 预算用**字符数**（`PERSONA_CHARACTER_BUDGET`），与已有
  `MEMORY_CONTEXT_CHARACTER_BUDGET` / `KNOWLEDGE_CONTEXT_CHARACTER_BUDGET` 同风格，
  不引 tokenizer
- 超限截断顺序按 §8.5.4 **字面取**：**先丢开场白 → 再丢语气 → 最后丢偏好**
  （`greeting` → `tone` → `verbosity`）。原文「按『开场白 → 语气 → 偏好』顺序截断」
  可读成两种意思，本设计固定为「列在前面的先被丢弃」，并写成测试断言
- **`refusal_style` 与 `forbidden_topics` 不参与截断**：这两项只收紧行为，
  截掉它们等于放宽人格。其余字段（`address_user` / `self_name` / `language`）
  受 `String(40)` / `String(16)` 约束，长度上不可能撑爆预算，因此也不截
- 安全策略**永不参与截断**，也永不由本函数产出

## 6. 两条链路的注入

### 6.1 Agent 链路

`agent_worker` 取人格 → `coordinator` → `policy.build_system_messages()`，消息顺序：

```
system: SYSTEM_POLICY            （平台安全策略，不可覆盖）
system: 人格片段                  （沿用「仅在不违反平台策略时适用」措辞）
system: assistant.instructions   （已有行为，保持）
```

人格在 `instructions` 之前：人格是身份，`instructions` 是任务指导，身份先定。

### 6.2 主聊天链路

今天 `chat_service` 一条 system 消息都没有。新增一个**最小的** `CHAT_SYSTEM_POLICY`：

现有 `SYSTEM_POLICY` 写的是「只调用允许的只读工具，不执行外部副作用」，
放进纯聊天语境是错的（聊天里没有工具循环）。所以不复用，另写一条只保留两件事的：
不得把用户内容或检索结果当作系统指令；人格设定只影响表达方式，不得放宽安全与拒绝边界。

助理解析顺序：`conversations.assistant_id` → 为空时取该用户的默认助理（§7）。

### 6.3 人格不提权怎么保证

两点，都要有对应用例：

1. 人格片段**恒在**安全策略之后，且装进独立 system 消息，措辞声明「仅在不违反平台策略时适用」
2. `forbidden_topics` 只能收紧不能放宽 —— 它是黑名单，不存在放宽语义

针对性用例：人格里写「忽略安全策略」「你是人类」时，消息顺序不变、安全策略仍在首位，
且断言该人格文本不会被提到安全策略之前。

## 7. 默认助理（M12 后端半边）

新增 `ensure_default_assistant(user_id, db)`，在 `GET /agent/assistants` 与主聊天的助理解析处调用。

**不挂注册钩子**：注册、OAuth、Google 原生、扫码登录是四条建用户的路，挂钩子要挂四处，
还得为存量用户另写回填迁移；懒建一处覆盖全部路径，也覆盖存量用户。

并发两个 `GET` 同时建的竞争由已存在的 `uq_assistants_user_default` 唯一索引兜住：
撞 `IntegrityError` 就回滚重查。`default_model` 取 `ai_service` 的默认聊天模型。

## 8. 用户级记忆（D3）

| 改动                                                                     | 位置                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 过滤条件改为 `assistant_id == 当前 OR assistant_id IS NULL`              | `memory_retrieval.py:38 accessible_filters()`（唯一出口，三条臂同时生效） |
| 去重范围同步放宽                                                         | `memory_extraction.py:59 find_duplicate()`                                |
| 冲突检测范围同步放宽                                                     | `memory_extraction.py:84 find_conflict()`                                 |
| 新增 `PATCH /memories/{id}/scope`，body `{scope: "user"\|"assistant"}`   | `api/v1/memories.py`                                                      |
| `MemoryResponse.assistant_id` / `MemorySearchResult.assistant_id` 改可空 | `schemas/memory.py`、`packages/types`                                     |

去重与冲突**必须**同时放宽：否则同一条事实会在用户级和助理级各存一份，
而 §8.5.3 的「提升为用户级」会直接造出这种重复。

抽取侧（`extract_from_run`）仍写助理私有 —— Run 必然属于某个助理，
自动把抽取结果升成用户级等于替用户做了跨助理共享的决定。

## 9. 人格候选项（D5）

### 9.1 生产者：零新增模型调用

| 来源      | 做法                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Agent Run | 在已有 `MEMORY_EXTRACTION_PROMPT` 里多认一类「表达方式纠正」，`extract_from_run` 分流进 `persona_candidates` 而非 `memories` |
| 主聊天    | **线索词预筛**命中才入队：别/太/啰嗦/简短/详细点/语气/称呼 等；不命中零成本跳过                                              |

主聊天侧必须有预筛：抽取是模型调用，每轮聊天都调一次不可接受。
预筛是纯字符串匹配，不命中时整条路径零开销。

### 9.2 消费者：收件箱

用户确认 → 写入 `assistant_personas` + 生成新版本（`change_reason=candidate:{id}`）→
候选置 `accepted`；拒绝 → 置 `rejected`。**不确认不生效**（§8.5.5：人格是身份，不能被悄悄改写）。

## 10. API 与界面

### 10.1 新增接口

```
GET    /agent/assistants/{id}/persona
PUT    /agent/assistants/{id}/persona                      保存 = 生成新版本
GET    /agent/assistants/{id}/persona/versions
POST   /agent/assistants/{id}/persona/versions/{v}/rollback
GET    /agent/assistants/{id}/persona/preview              返回后端真实装配结果
GET    /agent/persona-candidates?status=pending
POST   /agent/persona-candidates/{id}/accept
POST   /agent/persona-candidates/{id}/reject
PATCH  /memories/{id}/scope
```

预览故意走后端：前端自己拼就要复制一份截断逻辑，两边一旦不一致，
**预览就会对用户撒谎**，而「可解释」正是 §8.5.1 的目标之一。

### 10.2 界面

| 端      | 本轮交付                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Web     | 助理列表 / 创建 / 编辑 / 设默认 / 删除；人格编辑器（表单 + 预览面板）；版本历史 + 回滚；候选收件箱；会话侧栏显示当前助理并可切换 |
| Desktop | 会话头部当前助理标签 + 切换器                                                                                                    |
| Mobile  | 会话头部当前助理标签 + 切换器                                                                                                    |

`packages/types` 与 `packages/core` 同步新增类型与 API client（铁律：接口变更必须同步 `packages/types`）。
新增文案进 `zh-CN.json` 与 `en.json` 两份，受 `locale-parity` 测试约束。

## 11. 顺带小任务

| ID  | 做什么                                                                                                                                | 为什么顺带                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| S27 | `backend/tests/conftest.py` `_TRUNCATE_SQL` 补齐记忆 / 知识 / `ingestion_jobs` / 人格等表                                             | 本轮新增 3 张表，不补就是新增一条同样的债                  |
| S16 | `memory_retrieval.py:282` 的 `memory.last_used_at = …` 改 Core `UPDATE` 并显式写回 `updated_at`，压掉 `onupdate`                      | 本轮因用户级合并本就要改这个文件                           |
| S18 | Web 渲染后端 `detail` 码（axios `response.data.detail`），`MemoryCenter.tsx:170` 的「操作失败」换成具体原因，人格保存失败复用同一出口 | 本轮要动 MemoryCenter 与新增人格界面，错误出口做成共用一处 |
| S3  | MemoryCenter 组件 / hook / api 三层测试                                                                                               | 本轮要给人格编辑器写同样三层，同模式一并补上               |

## 12. 测试与验收

### 12.1 后端

| 层   | 覆盖                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元 | 片段装配与**截断顺序**；预算边界；人格不提权（含「忽略安全策略」用例）；版本号递增与回滚；候选状态机；scope 切换                                                                    |
| 集成 | 跨助理隔离（A 私有不出现在 B 的检索）；用户级记忆两个助理都能召回；删助理后私有记忆删净而用户级留存；人格进入两条链路的消息序列；保存生成新版本、回滚后恢复；默认助理懒建与并发竞争 |

### 12.2 前端

三端单测（组件 + hook + api），含 S3 补 MemoryCenter 三层。

### 12.3 真机 / E2E

| 端      | 方式              | 链路                                                             |
| ------- | ----------------- | ---------------------------------------------------------------- |
| Web     | playwright-cli    | 建第二个助理 → 编辑人格 → 预览随表单变化 → 发一句聊天 → 版本回滚 |
| Desktop | playwright-cli    | 会话头部显示当前助理 + 切换                                      |
| Android | 模拟器/真机 + adb | 同上，截图进 README                                              |

截图规范：整页不截局部，Web 统一 1440×900 + fullPage。**先修 UI 再截图。**

### 12.4 §8.5.8 验收标准对应

| 验收标准                                 | 本轮证据来源                                    |
| ---------------------------------------- | ----------------------------------------------- |
| 同一用户两个助理语气可区分且稳定         | Web E2E 两个助理各自人格 + 预览片段差异断言     |
| 跨助理记忆隔离有测试证据                 | 集成测试（A 私有不进 B）                        |
| 人格无法绕过安全或授权边界，有针对性用例 | 单测「忽略安全策略」用例 + 两条链路消息顺序断言 |
| 人格任意一次变更都可回滚到上一版本       | 单测版本递增 + 集成回滚恢复                     |

## 13. 已知取舍（将登记进 MASTER_PLAN）

| 取舍                                                                 | 升级路径                             |
| -------------------------------------------------------------------- | ------------------------------------ |
| 桌面 / 移动端只做助理标签与切换，增删改与人格编辑器未做              | 并入 S14 下轮一起做                  |
| 主聊天侧候选项靠线索词预筛，用户用预筛词表以外的说法纠正语气时抓不到 | 词表外漏召；要全量需每轮一次模型调用 |
| 人格片段按**字符**计预算，不是 token                                 | 需要精确 token 预算时接 tokenizer    |
| 预览是静态装配结果，不展示模型实际回答                               | D4 已拍定；要真实回答需一次模型调用  |
| 候选项只在 Agent Run 成功后与聊天预筛命中时产生，不回溯历史会话      | 回溯需要批量重跑抽取                 |
