# 元AI 交付状态总表

> **本文件是「还有什么没做」的唯一真源。**
> `README.md`、`CLAUDE.md`、`AGENTS.md` 只做能力概述，`docs/phases/*.md` 只描述该阶段应该做成
> 什么样，`docs/superpowers/plans/*.md` 是一次性执行脚本 —— **都不是真源**。
> 新发现的待实现项与主动留下的技术债，**当次登记到这里**：别的会话不知道本会话发现了什么，
> 漏登记等于永久丢失。

**图例**：✅ 已交付 · 🟡 已交付但有未关闭的验收项 · ⬜ 未开工（仅有阶段文档）

**最后更新**：2026-10-04

---

## 0. 未做清单总览（单一真源）

新会话从这里挑活：**选一项 M（主要功能）作主线，顺带捎上几项 S（小任务）**。
详情逐条见后续章节。完成后**当次回写本表状态**，新发现的债也当次登记进来。

图例：⬜ 未开工 · 🟡 部分实现 · ⛔ 本轮不做

### 主要功能（M）

| ID  | 阶段 | 条目                                                                                  | 状态 | 详情  |
| --- | ---- | ------------------------------------------------------------------------------------- | ---- | ----- |
| M1  | 7    | 记忆写入流水线 MemoryExtractor：从 Run 抽取 → 敏感度分级 → 去重 → 冲突检测 → 自动激活 | ✅   | §2.1  |
| M2  | 7    | 混合检索：pgvector 迁移（`embedding` 现为 JSON 列）+ FTS + RRF + rerank               | ✅   | §2.1  |
| M3  | 7    | 知识入库流水线：多格式解析、OCR、结构感知分块、`ingestion_jobs`、质量检查             | ✅   | §2.5  |
| M4  | 7    | Webhook 触发：`webhook_endpoints`、`/webhooks/{public_id}`、签名/重放/限流            | ✅   | §2.9  |
| M5  | 7    | Skill 评测门禁 `skill_evaluations`（不通过不替换 active）+ 从经验生成 Skill           | ✅   | §2.10 |
| M6  | 7    | 专属助手人格 Persona（复用 `memories.assistant_id` 隔离，人格不提权）                 | ⬜   | §5 N1 |
| M7  | 5    | 可观测性：8 个具名指标 + `/metrics` 暴露                                              | 🟡   | §2.4  |
| M8  | 4    | `yuanai://` 向系统注册 + `electron-builder.yml` + `resources/` 打包资产               | ⬜   | §3.1  |
| M9  | 3    | 原生 Google Sign-In + `POST /auth/google/native`                                      | 🟡   | §2.6  |
| M10 | 2    | `packages/ui` 组件库：`tokens.css` + `Button` + `MessageBubble` + 测试                | ✅   | §2.3  |
| M11 | 6    | Wave 2 补齐：图片 OCR、DOCX/XLSX/PPTX 生成、剪贴板工具                                | ✅   | §2.11 |
| M12 | 5/7  | 任何端都没有「创建助理」入口，Agent 与 Phase 7 控制面对新用户全部不可用               | ⬜   | §2.2  |
| M13 | 7    | Skill 全链路没有运行时消费者：建了/验了/激活了，Agent 从不加载                        | ⬜   | §2.2  |

### 小任务（S）

| ID  | 阶段 | 条目                                                                 | 状态 | 详情  |
| --- | ---- | -------------------------------------------------------------------- | ---- | ----- |
| S1  | 5    | `agent_worker` 构造 Coordinator 时传 `budget=`，并加 config 键       | 🟡   | §3.1  |
| S2  | 7    | `local_node` 记忆不再静默过滤：路由到在线节点或明确提示不可用        | ✅   | §2.1  |
| S3  | 7    | MemoryCenter 三层测试（组件 / hook / api）                           | ⬜   | §2    |
| S4  | 7    | Phase 7 列表接口游标分页                                             | 🟡   | §2.1  |
| S5  | 7    | 记忆导出 API                                                         | ✅   | §2.1  |
| S6  | 6    | `GET /tool-executions/{id}`；`/mcp-servers` 测试 / 启停 / 删除       | ⬜   | §3.1  |
| S7  | 6    | `update_required` 节点状态接线 + 测试（当前是死枚举）                | ⬜   | §3.1  |
| S8  | 3    | `useHydrateAuth` / `ChatInput` 单测                                  | ⬜   | §3.1  |
| S9  | 5    | 前端 Agent 测试：组件 + hook + E2E                                   | ⬜   | §3.1  |
| S10 | 7    | 自动化「复制」                                                       | ⬜   | §3.1  |
| S11 | —    | `packages/ui` 补测试后加回覆盖率阈值                                 | ✅   | §2.3  |
| S12 | 7    | 记忆检索评测集（Recall@K / MRR / 引用准确率）                        | ✅   | §2.1  |
| S13 | —    | 硬编码文案检测（61 文件 / 458 行，等于一次 i18n 迁移）               | ⬜   | §6    |
| S14 | 7    | Mobile / Desktop 侧 Phase 7 控制界面                                 | ⬜   | §2    |
| S15 | 7    | 知识库检索的中文长查询静默退化（声明 10000 字，FTS 实为 2046 字节）  | ⬜   | §2.2  |
| S16 | 7    | 检索仍顶 `updated_at`：响应字段对用户撒谎 + 污染新鲜度排序           | ⬜   | §2.2  |
| S17 | 7    | 记忆导出不含本机正文，文件永远无法完整还原本地记忆                   | ⬜   | §2.2  |
| S18 | 2    | Web 不渲染后端 detail 码，记忆增删改的错误全显示「操作失败」         | ⬜   | §2.2  |
| S19 | 2    | `ChatInterface.tsx` 2600+ 行无渲染测试（仅纯函数测试）               | ⬜   | §2.2  |
| S20 | 5    | `agent_steps.output_json` 是死列，drop 属独立迁移决策                | ⬜   | §2.2  |
| S21 | —    | `feature/memory-extraction-hybrid-search` 全分支 review 未完成       | ✅   | §2.2  |
| S22 | 7    | 向量臂无相关度下限：余弦 −1 的查询照样满分召回全部记忆               | ⬜   | §2.2  |
| S23 | 7    | 执行节点永久丢失后，`local_node` 记忆永远删不掉，无强制通道          | ⬜   | §2.2  |
| S24 | 6    | `run_node_job` 内部 `commit()` 会连带提交调用方的未提交改动          | ⬜   | §2.2  |
| S25 | 1/2  | 微信三方登录后端完全不存在，Web 入口已于 2026-10-02 隐藏             | ⬜   | §2.2  |
| S26 | 7    | 知识检索启用向量后**反而不走任何过滤**，只取最近 400 条 chunk        | ⬜   | §2.2  |
| S27 | —    | `conftest` 的 `_TRUNCATE_SQL` 不含知识/记忆/入库表，隔离靠级联       | ⬜   | §2.2  |
| S28 | 7    | Webhook payload 只有文本围栏，未按工具返回值隔离（依赖 M13）         | ⬜   | §2.9  |
| S29 | 7    | Skill 评测拿不到成功率/成本/平均 Step，要等执行面（依赖 M13）        | ⬜   | §2.10 |
| S30 | 6    | `complete_success` 两个分支体完全相同，是死分支                      | ⬜   | §2.11 |
| S31 | 6    | `ToolRisk.low = "read"` 是枚举别名陷阱，两个名字同一成员             | ⬜   | §2.11 |
| S32 | 6    | 二进制 Artifact 的预览只带 `{"size_bytes": N}`，界面无可展示内容     | ⬜   | §2.11 |
| S33 | 6    | `ArtifactKind` 没有 `presentation`，PPTX 被归到 `document`           | ⬜   | §2.11 |
| S34 | 7    | Skill 候选只扫最近 200 条 Run，更早的重复经验归纳不到                | ⬜   | §2.10 |
| S35 | 2    | 工具控制中心的「只读」徽章在工具名较长时被压成竖排单字               | ⬜   | §2.12 |
| S36 | 2    | 技能页「建议保存为技能」标题与说明游离在所有卡片之外                 | ⬜   | §2.12 |
| S37 | 2    | 记忆中心无卡片容器：两排同款 pill 语义不同、空态只有一行裸文字       | ⬜   | §2.12 |
| S38 | 2/3  | 流结束后会话列表仍在转圈（Web 侧栏与移动端抽屉同时复现）             | ⬜   | §2.12 |
| S39 | 3    | 移动端暗色模式模型选择器选中行仍是浅底，标题白字白底不可读           | ⬜   | §2.12 |
| S40 | 3    | 移动端「联网搜索」按钮恒为 disabled，无法开启                        | ⬜   | §2.12 |
| S41 | 3    | 移动端新会话输入栏缺图片/视频/音乐开关（会话内 7 个，新会话只 4 个） | ⬜   | §2.12 |

### 本轮不做（⛔）

| 条目                                                           | 原因                   |
| -------------------------------------------------------------- | ---------------------- |
| 生产部署环境验收、Windows/macOS 安装包签名与目标平台安装验收   | 属部署真实环境遗留问题 |
| Browser Worker 完整安全灰度、真实外部 MCP 经 UI 的完整链路验收 | 同上                   |

---

## 1. 阶段状态总表

| 阶段     | 主题                                 | 状态 | 说明                                                     |
| -------- | ------------------------------------ | ---- | -------------------------------------------------------- |
| Phase 0  | Monorepo 脚手架                      | ✅   | Turborepo + pnpm + 三端骨架                              |
| Phase 1  | FastAPI 后端核心                     | ✅   | 认证、会话、消息、SSE、文件；审计无缺口                  |
| Phase 2  | Next.js Web 端                       | 🟡   | 功能验收通过；`packages/ui` 已补齐（§2.3），余 S18 / S19 |
| Phase 3  | Expo React Native 移动端             | 🟡   | 已合入 `dev`；原生 Google 登录未实现（§3.1）             |
| Phase 4  | Electron 桌面端                      | 🟡   | `yuanai://` 未向系统注册、打包资产缺失（§3.1）           |
| Phase 5  | Agent 运行时与任务状态机             | 🟡   | 指标已暴露（§2.4）、token/金额预算未接线（§3.1）         |
| Phase 6  | 工具系统、MCP、沙箱、执行节点        | 🟡   | Wave 2 已补齐（§2.11），余协议版本门与 S30–S33           |
| Phase 7  | 记忆、知识库、Skills、自动化         | 🟡   | 六项核心机制均有代码面；Skill 仍无运行时消费者（M13）    |
| Phase 8  | 治理、控制中心、运营后台、可观测     | ⬜   | 仅有阶段文档                                             |
| Phase 9  | 生活/学习/工作空间与连接器           | ⬜   | 仅有阶段文档                                             |
| Phase 10 | 自主性、委派与评测                   | ⬜   | 仅有阶段文档                                             |
| Phase 11 | 个人数字孪生（含助手形象、实时语音） | ⬜   | 仅有阶段文档；形象与实时语音为本次新增范围               |
| Phase 12 | 开放生态（含跨渠道机器人）           | ⬜   | 仅有阶段文档；机器人章节为本次扩写                       |
| Phase 13 | 实时视频对话与视觉理解               | ⬜   | **本次新增阶段**，仅有阶段文档                           |
| Phase 14 | 终端 TUI 与本地执行节点              | ⬜   | **本次新增阶段**，仅有阶段文档                           |
| Phase 15 | 小程序端（Taro）                     | ⬜   | **本次新增阶段**，仅有阶段文档                           |

---

## 2. Phase 7 — 已落地的代码面

2026-09-15 核对当前 checkout，Phase 7 的**控制面**（数据模型、CRUD API、共享层、Web UI）
已实现并有自动化测试，不再是「尚未开始」。

> ⚠️ **2026-09-18 代码审计更正**：此前本节写的是「Phase 7 主干能力已实现」，**这个说法过宽**。
> 已实现的是「增删改查 + 界面」的控制面；Phase 7 文档 §4（记忆写入流程）、§5.1（混合检索）、
> §6.1（知识入库流水线）、§7.3（从经验生成 Skill）、§8.2（Webhook 触发）、§11.3（Skill 评测门禁）
> 所描述的**核心机制尚未实现**。逐条见 §3.1。
>
> ✅ **2026-09-29 更正的更正**：上述六项里，**§4（记忆写入流程）与 §5.1（混合检索）已实现**，
> 见 §2.1。**§6.1（知识入库流水线）已于 2026-10-02 实现**，见 §2.5。
> **§7.3（从经验生成 Skill）、§8.2（Webhook 触发）、§11.3（Skill 评测门禁）已于
> 2026-10-03 实现**，见 §2.9 / §2.10 —— 六项核心机制至此全部有代码面。
> 但 §11.3 想要的「成功率 / 成本 / 平均 Step」仍测不出来（Skill 无执行面，见 M13 与 S29），
> 评测取的是静态契约检查。

### 2.1 记忆抽取与混合检索（2026-09-29 交付）

分支 `feature/memory-extraction-hybrid-search`，43 个 commit。**以下每条都核对过文件与行号**，
不以「做了记忆相关的活」整片推断。

| 条目 | 状态 | 证据                                                                                                                                                                                                                                                                                                                                 |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1   | ✅   | `services/memory_extraction.py` 的 `extract_from_run` 依次做抽取 → `classify_sensitivity` → `find_duplicate` → `find_conflict` → `decide_status` → 激活时补 embedding。**链路闭环有据**：`workers/agent_worker.py:120` 投 `enqueue_extraction` → Redis `memory:extract` → `workers/memory_worker.py:29` 取出并调用 —— 不是只有控制面 |
| M2   | ✅   | `models/memory.py:103` 的 `embedding` 已是 `Vector(EMBEDDING_DIMENSIONS)`（迁移 `q1a2b3c4d5e6_add_pgvector_columns.py`），不再是 JSON 列；`search_vector` 为 TSVECTOR；`services/memory_retrieval.py` 以 RRF 融合 FTS 臂与 pgvector `cosine_distance` 臂，后接确定性规则 rerank                                                      |
| S2   | ✅   | `services/memory_node.py` 把 `local_node` 记忆路由到用户的桌面执行节点；节点不在线时 `MemoryPage.local_unavailable` 明确置真（按「本页含 `local_node` 行」且 `select_fresh_node(...) is None` 纯 SQL 判定，不发节点 RPC），不再静默过滤                                                                                              |
| S4   | 🟡   | **只有 `/memories` 加了游标分页**（`api/v1/memories.py:72` 的 `cursor` 参数）；`knowledge_bases` / `skills` / `automations` 三个列表接口仍无分页。本行按字面是「Phase 7 列表接口」复数，故只能标部分                                                                                                                                 |
| S5   | ✅   | `GET /memories/export`，路由声明在 `/{memory_id}` 之前以免被吞；伪造游标返回 422 而非静默首页                                                                                                                                                                                                                                        |
| S12  | ✅   | 评测集 + Recall@K / MRR / 引用准确率三条 floor（0.80 / 0.80 / 1.0），三轮重测一致。**floor 正好卡在本语料关键词检索天花板**：20 条标注查询中 4 条与答案无字面重叠，其余 16 条首位命中，16/20 = 0.80                                                                                                                                  |

> ⚠️ **部署前提（不满足则上述能力在生产环境空转）**：`memory:worker` 与 `node:sweeper`
> 必须作为常驻进程部署。前者不跑则 agent run 永不抽取记忆，后者不跑则失联节点永不置
> `offline`。四个 worker 的启动方式见 [开发运行指南](dev-guide.md)。

| 面       | 证据                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据模型 | `backend/app/models/{memory,knowledge,skill,automation,assistant}.py`                                                                                               |
| 迁移     | `n7a8b9c0d1e2_add_memory_context`、`o8a9b0c1d2e3_add_skill_versions`、`p9a0b1c2d3e4_add_knowledge_base`、`p9b1c2d3e4f_add_automations`                              |
| 服务     | `memory_service.py`、`memory_retrieval.py`、`knowledge_service.py`、`skill_service.py`、`skill_validation.py`、`automation_service.py`                              |
| Worker   | `backend/app/workers/automation_scheduler.py`                                                                                                                       |
| API      | `backend/app/api/v1/{memories,knowledge,skills,automations}.py`                                                                                                     |
| 共享层   | `packages/core/src/api/{memories,knowledge,skills,automations}.ts` + 对应 `hooks/use*.ts`                                                                           |
| Web UI   | `apps/web/src/app/(main)/agent/{memories,knowledge,skills,automations}` + `components/agent/*Center.tsx`                                                            |
| 后端测试 | 集成 `test_memories`、`test_knowledge_bases`、`test_skills_api`、`test_automations`；单元 `test_memory_service`、`test_skill_validation`、`test_automation_service` |
| Web 测试 | `components/__tests__/{KnowledgeCenter,SkillCenter,AutomationCenter}.test.tsx`（**MemoryCenter 无测试**）                                                           |

> 2026-09-16 实测（本地 PostgreSQL）：后端单元测试 **261 passed**，
> Phase 7 集成测试（memories / knowledge_bases / skills_api / automations）**11 passed**。
> 真实栈端到端验收状态见 §4。

### Phase 7 未关闭项

| 状态 | 条目                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | 2026-09-17 复跑：前端单元 **673 passed**（web 197 / desktop 304 / core 127 / mobile 45），Web E2E **66 passed**，Desktop 真机 E2E **3 passed** |
| 🟡   | 记忆检索评测（Phase 7 文档 §11.2）未见评测集与指标产出                                                                                         |
| 🟡   | Mobile / Desktop 侧的记忆、知识库、Skills、自动化控制界面未实现（仅 Web）                                                                      |
| ⬜   | **专属助手人格（Persona）** —— 本次新增范围，见 §5                                                                                             |

### 2.2 本轮新登记的债（2026-09-29，S21–S24 于 2026-10-01 全分支 review 时补登）

交付 §2.1 过程中发现、**本轮未修**的问题。逐条都核对过代码，不是推测。

| ID  | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S15 | **中文长查询静默退化**。实测 `plainto_tsquery('simple', …)` 在 **2046 字节（约 682 汉字）** 处退化成空查询：678 字仍可用、684 字起为空，**无异常、无日志**。记忆检索已把上限统一压到 500 字避开它，但**知识库检索仍声明 10000 字**，中文长查询会无声返回空结果。与中文分词债同根                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S16 | **检索会顶 `updated_at`**。`memory_retrieval.py` 在 ORM 实例上写 `last_used_at` 后 flush，触发 `models/memory.py` 的 `onupdate=func.now()`。分页排序键已改为不可变的 `created_at`（见发现 M），**不再丢数据**；但 `MemoryResponse.updated_at` 仍对用户撒谎（只读了一下却显示「刚修改」），并污染检索关键词臂的新鲜度排序 —— 关键词臂的次级排序键正是 `updated_at`，而两字中文查询下 `word_similarity` 对所有行恒为 0（见同文件 ponytail 注释），此时**整个关键词排序退化成 `updated_at DESC`**，于是上一次检索的赢家被钉在队首反复召回，形成赢者通吃的正反馈。最小修法：用 Core `UPDATE` 显式写 `updated_at=Memory.updated_at` 压掉 `onupdate`                                                                                                                                                                                                                         |
| S17 | **导出不含本机正文**。节点在线时 `localUnavailable` 为 `false`，但 `local_node` 条目的 `content` 依旧是 `null` —— 这份文件**永远不足以完整还原本机记忆**。已写进 schema docstring 与 TS JSDoc。真正的修法（导出时向节点批量取回）属新功能                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S18 | **Web 不渲染后端 detail 码**。记忆的创建/更新/删除错误在前端没有任何出口，新加的 `504 LOCAL_MEMORY_APPROVAL_TIMEOUT` 对网页用户只表现为「操作失败」，用户无从知道是自己审批超时                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S19 | **`ChatInterface.tsx` 2600+ 行却只有纯函数测试**，模型目录的加载态与失败态在 web 侧无渲染测试（逻辑覆盖做在 `packages/core`，desktop 有渲染测试）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S20 | **`agent_steps.output_json` 是死列**。API 字段已移除（`28e6a14`），数据库列保留，drop 属独立迁移决策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S21 | ✅ **全分支 review 已完成**（2026-10-01）。前两次派出的审查都被基础设施配额错误（HTTP 402）中断，改由主会话逐面手查，五个面全覆盖：隐私边界（查出并修掉 `source_excerpt`/`structured_data` 绕道上云，`625153e` + `3b9c59a`）、游标健壮性（四类畸形输入均被单个 `except ValueError` 兜住）、异常吞底（新代码无 `except Exception`）、检索融合（查出并修掉节点分数霸榜，`f68ea9c`；另登记 S22）、节点存活与作业路由（`node_is_fresh` 直判 `last_seen_at`，不依赖 sweeper 跑过；无节点立刻 `unavailable` 并如实冒泡成 `localUnavailable`，不伪装成「没有记忆」；另登记 S23/S24）                                                                                                                                                                                                                                                                                          |
| S22 | **向量臂没有相关度下限**。`_cloud_results` 的向量臂只有 `ORDER BY cosine_distance LIMIT recall`，没有任何距离阈值；而 RRF 只消费名次，首名无论距离多远都得 `1/(RRF_K+1)`。实测：存两条记忆后用与它们**正交**（余弦 0）乃至**反向**（余弦 −1）的查询向量检索，关键词臂零命中的情况下仍召回全部 2 条，分数 0.125 / 0.1071 —— 与完美匹配拿到的分数一模一样。两个线上调用点（`api/v1/memories.py:113`、`agent/coordinator.py:541`）都传 embedding，因此**只要库里有记忆，检索就永远不会返回空**，`coordinator` 会把这些无关记忆当成用户事实注入上下文；返回给客户端的 `score` 同样不含匹配质量信息。修法要定一个余弦阈值，需拿真实 embedding 模型在 `tests/integration/test_memory_retrieval_eval.py` 上标定精确率/召回率，拍数字属独立决策，不在本轮瞎猜                                                                                                                  |
| S23 | **节点永久丢失则本地记忆永远删不掉**。`delete_memory` 对 `local_node` 记忆先调 `drop_local_memory`，节点不可用时抛错、整次删除失败（这是刻意的：好过把正文永久留在用户磁盘上）。但机器丢了或重装了的用户，这些记忆连同云端元数据**再也删不掉**，没有强制通道。真正的修法（带明确告知的强制删除，承认正文可能仍留在那台机器上）属新功能                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S24 | **`run_node_job` 内部会 `commit()`**。它必须提交执行记录才能让节点网关看见（`tool_runtime_service.py`），于是**连带提交调用方当时所有未提交的改动**。当前三个调用点都安全，但安全性全靠调用顺序：`create_candidate` 刻意把 `push_local_memory` 放在 `db.add` 之前，一次检索里 `_cloud_results` 写的 `last_used_at` 则会被本地臂的这次 commit 顺手提交。下一个在改了一半数据之后调用它的人会拿到静默的部分提交，而且不会有任何报错                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M12 | **任何端都没有「创建助理」入口**（2026-10-02 登记）。后端有 `POST /agent/assistants`（`backend/app/api/v1/agent.py:78`），`packages/core` 也导出了 `createAssistant`（`packages/core/src/api/agent.ts:50`），但 `apps/web`、`apps/mobile`、`apps/desktop` 三端加起来**零处调用**，注册流程也不自动建默认助理（`is_default` 在 `backend/app/services/` 下只出现在 `ai_service.py` 的模型列表里，与助理无关）。后果是新用户的助理列表恒为空，而五个控制面全部以「取到助理」为前提：`MemoryCenter.tsx:112/136`（记忆类型开关与「添加记忆」按钮恒 `disabled`）、`AgentWorkspace.tsx:438`（`if (!assistant …) return`，**连 Agent Run 都发不出去**）、`AgentSettings.tsx:59`、`SkillCenter.tsx:241`、`AutomationCenter.tsx:35`。也就是说 Phase 5/7 的控制面对真实用户整体不可达，只有直接打 API 建过助理的人才看得见功能——本仓此前所有 Phase 7 界面验证都是在这种前提下做的 |
| S25 | **微信三方登录只有壳**（2026-10-02 登记并隐藏入口）。后端 `auth.py` / `oauth_service.py` / `config.py` 里 `wechat`、`weixin` **零命中**，没有路由、没有服务、没有配置；而 Web 登录页一直渲染着一个 `disabled` 的「微信」按钮（`title="第三方登录即将开放"`），设置页也有一行恒为「未绑定」且点不动的微信绑定。已按用户要求把这两个入口删掉（`login/page.tsx` 的按钮、`SettingsModal.tsx` 的绑定行，连同只为微信存在的 `available` 开关与其死分支），i18n 文案与图标资源保留，等后端落地再放回来。移动端与桌面端本来就没有微信入口，无需改动                                                                                                                                                                                                                                                                                                                            |
| S26 | **知识检索一旦启用向量就不做任何过滤**（2026-10-02 登记，已逐行核对 `knowledge_service.py:275-290`）。`query_embedding is None` 时才会加 `WHERE`（FTS + ilike 关键词，`:275-281`）；**非 None 时整段过滤被跳过**，候选集退化成 `order_by(KnowledgeChunk.created_at.desc()).limit(min(limit*20, 400))`，即「最近 400 条 chunk」，再在 Python 里打分。后果是知识库一旦超过 400 条 chunk，更早的相关内容**永远召回不到**，且**配了 API Key 的生产环境反而比没配 Key 的开发环境更差**（后者走关键词过滤，至少命中全库）。记忆侧 `memory_retrieval.py` 已有正确的 pgvector + FTS + RRF 实现，知识侧应复用。这条直接影响 phase-7「pgvector + FTS 混合检索达到阈值」的验收                                                                                                                                                                                                    |
| S27 | **测试库清理清单不全**（2026-10-02 登记）。`backend/tests/conftest.py` 的 `_TRUNCATE_SQL` 没有列出知识库 / 记忆 / `ingestion_jobs` 等表，用例间隔离完全依赖 `users ... CASCADE` 级联。任何未来不以 `users` 为外键根的新表都会在用例之间静默串状态，且失败现象会出现在别的用例里，很难定位                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M13 | **Skill 是个没有消费者的控制面**（2026-10-02 登记，已自行核对）。`grep -rln "skill" backend/app --include=*.py -i` 只命中 7 个文件：`models/skill.py`、`schemas/skill.py`、`api/v1/skills.py`、`services/skill_service.py`、`services/skill_validation.py`、`models/__init__.py`，加上只负责注册路由的 `main.py`。`grep -rn "skill" backend/app/services/agent/ backend/app/workers/ -i` **零命中**——Agent 运行时（coordinator、各 worker）从不加载、从不注入、从不执行任何 Skill。也就是说用户可以创建 Skill、通过校验、激活版本，而这些动作对 Agent 的实际行为**没有任何影响**。这同时意味着 §11.3 评测门禁里「成功率 / 成本 / 平均 Step」四项指标在当前仓库里无从测起（M5 因此只能做静态契约评测），phase-7 §7.3「从经验生成 Skill」产出的 Skill 同样无人消费                                                                                                       |

> 另有一条**已在本轮修掉**、值得记住的失效模式：`tests/integration/test_browser_worker.py`
> 断言了 example.com 的线上正文，该站点删掉 `<h1>` 后本仓 CI 会直接变红（CI 跑集成套件且带
> `-x`，一红即停）。已改为只断言正文非空（`8039c8e`）。**测试不要断言外部站点的文案。**
>
> 另一条同样**已修**、同样值得记住的：跨组件比较分数前必须先对齐量纲。桌面节点回传的
> `score` 是 `1/(index+1)`（名次倒数，节点侧注释已写明「云端按名次再做融合排序」），
> 云端分数则是 RRF 融合＋规则重排之后的值，上限 0.383、典型 0.08。两者同表排序的结果是
> 节点命中无条件吃满整个 `limit`（`limit=8` 实测 8/8），云端记忆被静默挤出上下文，
> 且挤出与相关度无关；节点自报一个 `9.0` 就能霸榜，而回包是不可信输入。已改为按名次换算成
> `1/(RRF_K+r)`，与云端单臂同口径（`f68ea9c`）。**两路分数来自不同打分器时，先换算名次再排序。**

---

### 2.3 `packages/ui` 共享组件库（2026-10-02 交付，Phase 2 / M10 + S11）

2026-09-18 审计登记的「交付物从未创建」已关闭。**逐条核对过文件与行号**。

| 条目 | 状态 | 证据                                                                                                                                                                                                                                                                           |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M10  | ✅   | `packages/ui/src/styles/tokens.css`（79 行）照 `docs/ui-spec.md` 落背景/文字/品牌/边框/功能色/代码块/间距/圆角/字体全部变量，`tokens.css:62` 的 `[data-theme='dark']` 覆盖暗色；`packages/ui/src/styles/globals.css:2` 引入它，使 `@yuanai/ui/styles` 单入口即可拿到全部 token |
| M10  | ✅   | `packages/ui/src/components/Button.tsx:8` 的 `cva` 定义 primary/secondary/ghost/danger 四变体与 sm/md/lg/icon 四尺寸；`Button.tsx:67` 原生分支置 `aria-busy` 并把 `loading` 并入 `disabled`，`Button.tsx:68` 注入 spinner；`Button.tsx:58` 的 `asChild` 分支走 Radix `Slot`    |
| M10  | ✅   | `packages/ui/src/components/MessageBubble.tsx:20` 助手消息无气泡直出正文，`MessageBubble.tsx:25` 用户消息右对齐渐变气泡（`rounded-[18px_18px_4px_18px]`），与 `docs/ui-spec.md`「核心组件规范 / MessageBubble」一致                                                            |
| M10  | ✅   | `packages/ui/src/index.ts:2` 经 `src/components/index.ts` 导出 `Button` / `MessageBubble` 及其 props 类型；全部导出带中文 JSDoc，包内零平台专用 API                                                                                                                            |
| M10  | ✅   | 测试 17 条：`src/components/__tests__/Button.test.tsx`（10 条，含 disabled / loading / asChild / 变体 / `cn` 覆盖）、`MessageBubble.test.tsx`（4 条）、`src/lib/__tests__/cn.test.ts`（3 条）；`packages/ui/tests/setup.ts` 接 `jest-dom` 并在每例后 `cleanup`                 |
| S11  | ✅   | 实测覆盖率 **100 / 100 / 100 / 100**（stmts / branch / funcs / lines），按仓库防退化棘轮约定写回 `packages/ui/vitest.config.ts:14`；同时去掉 `passWithNoTests`，测试集消失即报错                                                                                               |

> ⚠️ **仍未做**：`apps/web` 依旧没有任何文件 import `@yuanai/ui`，Web 端的 Button /
> 消息气泡等价物留在 `apps/web/src/components/`。把 Web 迁到共享包属独立改动（会动 Phase 2
> 已验收的界面），不在 M10 范围内。
>
> `react-dom` 是 `@testing-library/react` 的 peer，本包未显式声明，靠
> `pnpm-workspace.yaml` 的 `publicHoistPattern: '*'` 解析 —— 与 `packages/core` 同一形态。
> 显式声明会连带把 pnpm 重新解析出的无关 peer-id churn 写进 `pnpm-lock.yaml`，故维持现状。

### 2.4 Agent 运行时可观测性（2026-10-02 交付，Phase 5 / M7）

2026-09-18 审计登记的「§14 可观测性指标未实现」已基本关闭。**逐条核对过文件与行号。**
指标注册表与 8 个具名指标集中在 `backend/app/core/metrics.py`（counter + histogram
两种类型自写约 190 行，**未引入 prometheus-client**），`/metrics` 由
`backend/app/main.py:128` 以 Prometheus 文本格式暴露，与 `/health` 同样不要求认证
（标签全是低基数枚举，无用户内容与原始身份）。

| 指标                                  | 状态 | 定义 / 埋点 / 测试                                                                                                                                                                                                         |
| ------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_runs_total{status,model}`      | ✅   | `core/metrics.py:171` 定义；`services/agent/coordinator.py:216` 在 `_record_run_metrics`（唯一汇合点，`run()` 包住整个 bounded loop）上报；`tests/unit/test_agent_metrics.py:154`                                          |
| `agent_run_duration_seconds`          | ✅   | `core/metrics.py:174`；`coordinator.py:227`，只在终态（`TERMINAL_RUN_STATUSES`）观测，避免把审批暂停片段计成一次完整 Run；`tests/unit/test_agent_metrics.py:154`                                                           |
| `agent_steps_per_run`                 | ✅   | `core/metrics.py:177`（桶 1/2/4/8/12/20/40）；`coordinator.py:228`；`tests/unit/test_agent_metrics.py:154`                                                                                                                 |
| `agent_tool_calls_total{tool,status}` | ✅   | `core/metrics.py:180`；四个埋点覆盖成功与三类失败：`coordinator.py:593`（succeeded）、`:568`（timeout）、`:582`（ToolError 按错误码分 timeout/failed）、`:543`（桌面节点执行失败）；`tests/unit/test_agent_metrics.py:154` |
| `agent_approval_wait_seconds`         | ✅   | `core/metrics.py:183`；`approval_service.py:210` 在 `decide()` 这个 approve/deny 的唯一汇合点调用 `_record_approval_wait`（`:78`）；`tests/unit/test_agent_metrics.py:212`                                                 |
| `agent_recovery_total{reason}`        | ✅   | `core/metrics.py:186`；`workers/recovery_worker.py:83` 记 `reason="inflight"`、`:95` 记 `reason="lease_lost"`；`tests/unit/test_agent_runtime_workers.py:493`                                                              |
| `agent_tokens_total{model,direction}` | ✅   | `core/metrics.py:187`；`coordinator.py:220/222` 按**本次片段增量**上报（审批恢复会在同一 Run 上再调一次 `run()`，上报累计值会重复计数）；`tests/unit/test_agent_metrics.py:154`                                            |
| `agent_estimated_cost_usd{model}`     | 🟡   | `core/metrics.py:190` 已定义并在 `coordinator.py:225` 接上 `run.estimated_cost_usd` 的片段增量，`/metrics` 也声明了该指标；**但该字段全仓从未被累加**（只在 `coordinator.py:180` 初始化为 0），因此序列恒为 0 —— 无测试    |

> ⚠️ **M7 记 🟡 的唯一原因**：`agent_estimated_cost_usd` 没有数据源。成本核算需要一张
> 单价表 + 汇率口径，而 `ai_service.py:506/521` 只有 DeepSeek 两个模型的**人民币**单价，
> 其余模型无价。拍单价与汇率属独立决策，不在本轮瞎凑，与 §3.1 Phase 5「token / 金额上限
> 在生产路径未生效」同根。

### 2.5 知识入库流水线（2026-10-02 交付，Phase 7 / M3）

2026-09-18 审计登记的「知识入库流水线未实现」已关闭。流水线为
`取文件 → 解析/OCR → 质量检查 → 结构感知分块 → 向量化`，落在三个新服务里：
`knowledge_parse.py`（多格式结构化解析，347 行）、`knowledge_ocr.py`（RapidOCR 适配 +
降级，53 行）、`knowledge_ingestion.py`（流水线与作业状态机，254 行）。
`ingestion_jobs` 表与 `knowledge_documents.parser` 列由迁移 `u6f7a8b9c0d1` 建立。

| 验收项             | 状态 | 证据                                                                                                                                                                                                                                |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 多格式解析         | ✅   | Markdown/HTML 按标题路径、PDF 按 `第 N 页`、xlsx 按 `工作表 X 第 a-b 行`、csv 按行区间、docx 按标题样式、Python 按 AST 顶层符号（`file.py::name`）分块                                                                              |
| OCR                | 🟡   | RapidOCR 作为**可选 extra**（`pyproject.toml` 的 `[project.optional-dependencies] ocr`，不进默认安装）；未安装时降级而非失败。**真实引擎从未跑过**，适配层 `result, _ = engine(image)` 的返回形状未经真引擎验证，首次真装必须先核对 |
| 结构感知分块       | ✅   | `create_document_version(blocks, parser)` 保留 section 与字符偏移；`test_markdown_file_ingests_and_citations_keep_section` 断言发布后引用的 `section == "测试文档1 > 引用定位"`                                                     |
| `ingestion_jobs`   | ✅   | 迁移在真实 Postgres 上验证过：`upgrade head` 走 `t5e6f7a8b9c0 -> u6f7a8b9c0d1`，`alembic heads` 单头，`downgrade -1` 后表与列均归零                                                                                                 |
| 质量检查           | ✅   | `EMPTY_CONTENT`/`GARBLED_CONTENT` 致命；`PARTIALLY_GARBLED`/`SHORT_CONTENT`/`DUPLICATE_CONTENT`/`OCR_UNAVAILABLE` 告警。失败的文档**不建 document**，不会污染检索结果                                                               |
| 降级路径有测试覆盖 | ✅   | `test_scanned_image_without_ocr_is_degraded_not_failed`：作业 `degraded`、`errorCode=OCR_UNAVAILABLE`、不建文档，并捕获到 `WARNING app.services.knowledge_ocr: OCR 不可用…`                                                         |

新增接口两个：`POST /knowledge-bases/{id}/sources/file`（201 返回 `IngestionJobResponse`）、
`GET /knowledge-bases/{id}/ingestion-jobs`。解析/格式/OCR 问题一律返回 201 + 作业状态
（`failed`/`degraded`）与 `errorCode`，不转成 HTTP 错误——作业本身就是审计记录；
404/403 只用于 ACL 与文件不存在。

实测门禁：`pytest` 全量 **648 passed, 1 skipped**（本功能自身 18 条）；
`ruff check` 全通过、`ruff format --check` 239 文件已格式化、`mypy app/` 120 文件无问题
（无新增 `# type: ignore`，无 `Any`/`object` 兜底）。提交 `8fb0412`。

**M3 未做到的部分**（不含在 M3 条目里，但如实记）：

1. 病毒扫描（phase-7 §6.1 的流水线步骤）未实现——本机没有扫描器，且不在 M3 条目内
2. **流水线在请求内同步跑**，没有队列/worker（代码里有 `ponytail:` 标注）。这是刻意的：
   再加一个常驻 worker 会重蹈 `memory:worker` 的覆辙——没启动时静默缺功能。
   大文件与批量导入需要重新考虑
3. 没有作业重试接口；重新入库只能重新上传并带 `sourceId`。phase-7 §10 的顶层
   `/knowledge-sources`（connect/sync/pause/re-ingest）与 `/knowledge-documents` 两个路由族
   仍不存在，只有挂在 knowledge-bases 下的嵌套路由
4. 邮件/聊天线程分块（§6.2）未实现——目前没有这类来源类型。非 Python 的代码文件退化为整文件块
5. 页码以文本形式存在 `section` 里（`第 3 页`），不是数值列
6. 入库作业没有任何前端界面（本任务只做后端）
7. 开发/测试环境下 `maybe_embed_text` 在无 `OPENAI_API_KEY` 时返回 `None`，
   chunk 向量为空、检索退化为关键词——这是既有行为，本次未改变

### 2.6 原生 Google Sign-In（2026-10-02 交付，Phase 3 / M9）

后端新增 `POST /api/v1/auth/google/native`（免认证），请求体只收 `idToken`，
返回与既有回调同口径的 JWT。移动端接 `@react-native-google-signin/google-signin`
（**原本就在 `apps/mobile/package.json` 里**，无幽灵依赖），拿到 id_token 后调该接口。
未改表结构，**没有新增迁移**——`users.google_id` 列早已存在。

**id_token 校验是真的在验签**（已逐行核对 `oauth_service.py:368-387`）：
用 Google JWKS 公钥集 `jwt.decode`，`algorithms=["RS256"]` 写死（堵掉 `alg: none`），
`issuer` 比对、`require_exp: True`；`verify_aud` 关掉**不是跳过校验**，而是因为 jose 只
接受单个 aud，紧接着在 `:381-386` 手工比对允许集合（`GOOGLE_CLIENT_ID` 恒在内

- `GOOGLE_NATIVE_CLIENT_IDS` 逗号分隔，解决 Android 客户端 aud 可能是 Web 或 Android
  client id 的问题）。JWKS 按 1 小时 TTL 缓存。

错误码：401 `OAUTH_ID_TOKEN_INVALID`（验签/iss/exp/aud 任一不过）、
400 `OAUTH_EMAIL_UNAVAILABLE`（无邮箱或 `email_verified` 非 true）、
503 `OAUTH_NOT_CONFIGURED`、503 `OAUTH_NETWORK_ERROR`（拉不到 JWKS）。

实测门禁：后端全量 `648 passed, 1 skipped`（新增 19 例，oauth 相关共 40 passed）；
`ruff check` 全通过、`mypy app/` 120 文件无问题；`pnpm typecheck` 6/6、`pnpm lint` 3/3、
`pnpm test:unit` 全绿（ui 17 / mobile 52 / desktop 327 / core 136 / web 213）。
安全向用例在测试里**自生成 RSA 密钥对签 token 并走真实 jose 验签路径**，只省掉对 Google
的网络请求：`test_wrong_signing_key_rejected`（攻击者自签、claims 全合法但公钥不在 JWKS）、
`test_foreign_audience_rejected`、`test_expired_token_rejected`、`test_wrong_issuer_rejected`、
`test_missing_exp_rejected`、`test_unverified_email_rejected`。
提交 `8aef8fd`（后端）、`3ce1f1b`（移动端）、`64967e3`（文档）。

配套文档 `docs/guides/google-android-oauth.md`（已进 `docs/README.md` 索引）：
包名取法、debug / release SHA-1 的三种取法、Web 与 Android client id 的 `aud` 对应关系、
后端与移动端环境变量、以及「Google OAuth 本身不收费」的说明，全文只用占位符。

> ⚠️ **M9 记 🟡 而不是 ✅ 的原因**：**完整原生链路从未真机/模拟器联调过**
> （SDK 弹账号选择器 → 真 id_token → 后端换 JWT）。这是**用户当次拍板的范围裁剪**
> （先写代码+文档，不申请真实 Android OAuth 客户端），不是实现缺口。
> 另：iOS 全部未实测（无 macOS/iOS 设备），`app.json` 的 `plugins` 里**没有**加该库的
> 配置插件（iOS 的 `iosUrlScheme` 需要真实 iOS client id）；移动端也没跑
> `expo prebuild` 或 Android 构建。

> 另两处有意为之的简化：指标存在**进程内存**里（API 与四个 worker 各自暴露自己的值，
> 由采集端按 instance 聚合，进程重启归零 —— counter 的正常语义）；coordinator 抛异常
> 逃出 `run()` 时不记录终态（`agent_worker.py` 会 `logger.exception` 兜住，这类 Run
> 的状态留在 `running`，由恢复 worker 重投并计入 `agent_recovery_total`）。
>
> `services/agent/metrics.py` 的结构化日志 `AgentMetrics` **保持原样**：它记的是带
> `run_id` / `step_id` / 哈希 `user_id` 的事件日志（Phase 5 §14 后半句的要求），
> 与本节的聚合指标是两件事，没有合并。

### 2.7 M4 / M5 的范围决策（2026-10-02 拍定）

> **两项均已于 2026-10-03 交付**，交付证据见 [§2.9](#29-webhook-触发2026-10-03-交付phase-7--m4)
> 与 [§2.10](#210-skill-评测门禁与从经验生成-skill2026-10-03-交付phase-7--m5)。
> 本节保留当时的范围决策记录，解释实现为什么长这样，**不要据此以为还没做**。

M4（Webhook 触发）与 M5（Skill 评测门禁 + 从经验生成 Skill）的四条范围决策：

1. **评测门禁只在「替换已有 active 版本」时强制**，首次激活放行。依据是 phase-7 §11.3
   「不通过不替换 active」的字面语义；改成全量强制会让 12 条既有 skill 集成测试全红，
   那是用测试迁就实现
2. **评测取静态契约，不做真实执行**。依据见 §2.2 的 M13：Skill 没有运行时消费者，
   没有执行面就没有「成功率 / 成本 / 平均 Step」可测。真执行需要先建 Skill 执行链，
   属独立的大事，不在 M5 范围内
3. **`skill_evaluations.estimated_cost_usd` 与 `avg_steps` 在无执行面时必须留 `NULL`**，
   禁止填 0 或编数字。M7 已经因为同类问题记 🟡（`agent_estimated_cost_usd` 定义了但
   无数据源、序列恒为 0）——一个恒为 0 的指标比 `NULL` 更有害，因为它看起来像真的。
   `validation_result` 里如实标 `"executed": false` 与原因
4. **从经验生成 Skill 用规则聚类，不用 LLM**。归一化 + 关键词 Jaccard 阈值，确定可测零成本；
   评测门禁是安全向机制，引入非确定性没有收益

Webhook 侧已定的设计要点：`webhook_endpoints.public_id` 用 `secrets.token_urlsafe(32)`
（**不可枚举**，不是自增）；密钥走既有 `TenantSecretStore` 的 AES-GCM，不新造加密，明文只在
创建/轮换时返回一次；签名用**原始 body 字节**做 HMAC-SHA256 并以 `hmac.compare_digest`
常量时间比对（重序列化 JSON 会因键序差异让合法请求验签失败）；重放防护以签名摘要为 nonce
写 Redis 且**不可用时 fail closed（503）而不是放行**；限流按 endpoint 的分钟桶计数；
触发时 `occurrence_key = f"webhook:{endpoint.id}:{delivery_id}"` 使重复投递天然幂等。
迁移 id 预留 `v7a8b9c0d1e2`（Webhook）与 `w8b9c0d1e2f3`（`skill_evaluations`），
`down_revision` 依次接 `u6f7a8b9c0d1`。

### 2.8 M11 的范围决策（2026-10-02 拍定）

> **已于 2026-10-03 交付**，证据见 [§2.11](#211-wave-2-工具2026-10-03-交付phase-6--m11)。
> 本节保留当时的范围决策记录。

M11（Wave 2 工具：图片 OCR、DOCX/XLSX/PPTX 生成、剪贴板）已定的要点：
图片 OCR **复用 §2.5 的 `knowledge_ocr.py`**（RapidOCR 可选 extra + 降级），
不写第二份适配；文档生成的文件名来自模型输出，属不可信输入，**必须复用
`knowledge_service` 的基目录约束**挡路径穿越；剪贴板是用户本机资源，走执行节点通道，
节点不在线必须明确报不可用，禁止静默返回空串假装成功。

### 2.9 Webhook 触发（2026-10-03 交付，Phase 7 / M4）

提交 `329e051`。新增迁移 `v7a8b9c0d1e2`、`app/api/v1/webhooks.py`、
`app/services/webhook_service.py`，`automation_triggers.trigger_type` 扩出 `webhook`
并把库里的 `varchar(4)` 对齐到模型声明的 16（`create_all` 的测试库看不到这个差异，
只在迁移链上存在）。

公网未认证入口 `POST /webhooks/{public_id}`，三道校验**全部 fail closed**（已核对代码）：
HMAC-SHA256 用 `hmac.compare_digest` 常量时间比对（`webhook_service.py:403`）且签名覆盖
时间戳；时间戳窗口外拒绝，窗口内以签名摘要为 nonce 登记防重放；按 endpoint 的分钟桶限流。
**重放与限流存储不可用时返回 503 而不是放行**（`WEBHOOK_GUARD_UNAVAILABLE` /
`WEBHOOK_SECRET_UNAVAILABLE`，均为 503）。`public_id` 取 `secrets.token_urlsafe(32)`
不可枚举；签名密钥走既有 `TenantSecretStore` 加密，库里只存引用与辨认前缀，明文仅在
创建与轮换响应各出现一次。触发时 `occurrence_key = webhook:{endpoint.id}:{delivery_id}`
使重复投递天然幂等。

> ⚠️ 第三方 payload 进入 Run 目标时只加了**显式数据围栏并截断**，这是降低 prompt
> injection 成功率的缓解措施，**不是隔离**。彻底的做法是让 payload 以工具返回值进入
> 上下文，取决于 M13 的 Skill / 工具执行面，已登记为 S28。

### 2.10 Skill 评测门禁与从经验生成 Skill（2026-10-03 交付，Phase 7 / M5）

迁移 `w8b9c0d1e2f3` 建 `skill_evaluations`（已在独立 scratch 库上实跑
`upgrade head → downgrade -1 → upgrade head`，`alembic heads` 单头 `w8b9c0d1e2f3`）。
新增 `app/services/skill_evaluation.py`（纯函数用例，不碰库）与
`app/services/skill_experience.py`（规则聚类），接口
`POST /skills/{id}/versions/{vid}/evaluate` 与 `GET /skills/suggestions`。

**门禁语义**：`_set_active_version` 在 `rollback=False` 且**已存在 active 版本**且目标
版本不是它时，要求目标版本**最近一次**评测为 `passed`，否则
409 `SKILL_VERSION_EVALUATION_REQUIRED`（从未评测）/ `SKILL_VERSION_EVALUATION_FAILED`。
只看最近一次，是为了让注册表变化后重测出的失败能推翻此前的通过记录。
**首次激活与回滚不设门禁**：首次激活没有可被弄坏的生产版本；回滚是 phase-7 §7.2 里
「评测回退时」的恢复手段，给它加门禁等于堵掉唯一退路。

六条静态用例（固定六条，manifest 解析失败时依赖用例**判失败而不是跳过**，否则通过率虚高）：

| 用例                         | 判什么                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `manifest_contract`          | manifest 仍能按受限契约解析，且声明版本与版本行一致    |
| `content_integrity`          | 内容指纹与入库时一致（检测落库后被改写）               |
| `tool_contract`              | 声明工具在**评测时点**仍注册、版本可满足、不超风险上限 |
| `declared_tool_coverage`     | 指令里反引号引用的工具必须在 `required_tools` 内       |
| `risk_ceiling_not_escalated` | 新版本不得把风险上限抬高过待替换的 active 版本         |
| `secret_scan`                | manifest 与指令里没有内联凭据字面量                    |

`declared_tool_coverage` **只认反引号包裹的工具名**：散文里的 "calculate the total" 不该
被当成调用 `calculate`，有专门的用例守这条（`test_prose_mention_without_backticks_...`）。
`secret_scan` 的 detail **只回报模式名、不回显命中内容**，同样有用例守。
未声明工具会绕过 manifest 的风险上限，审批与预算就按错的上限算，这是
`declared_tool_coverage` 存在的原因。

**从经验生成 Skill**（phase-7 §7.3）：扫最近 200 条 `succeeded` 的 Run，目标文本切词后按
Jaccard ≥ 0.6 贪心聚类，**≥ 3 次**才出候选。中文切**二元组而不是单字** —— 单字会让
「写周报」和「写邮件」因共享「写」而相似度虚高，有用例守这条。候选给出步骤（成功工具
步骤的工具名按首现顺序）、参数化位置（同一工具跨次取值不同的参数键）、`name@^major`
形式的 `required_tools`、以及所用工具的最高风险作 `risk_ceiling`。候选**在返回前先自检**
（走一遍 `parse_manifest` + `validate_manifest_tools`），自检不过就不递给客户端，免得用户
点「保存为草稿」拿到 422。**不写库**：用户点按钮才走既有 `POST /skills`，落为 `draft`，
仍需验证 → 评测 → 激活，满足 §7.3「必须由用户确认后进入验证流程」。

**消费侧同时落地**（CLAUDE.md 的「新增功能必须确认消费侧可达」）：不加 UI 的话，门禁会
让用户在界面上**永远无法替换 active 版本** —— 有门禁、没有触发评测的入口。
`packages/types` 补 `SkillEvaluation` / `SkillEvaluationCase` / `SkillSuggestion` 与
`SkillVersion.latestEvaluation`；`packages/core` 补 `evaluateSkillVersion` /
`listSkillSuggestions` 与两个 hook；Web `SkillCenter` 在 `validated` 版本上加「评测」按钮、
展示最近一次评测的通过数与失败用例明细，并新增候选区（步骤 / 参数化位置 / 工具 / 风险 +
「保存为草稿」）。中英语言包各补 11 条键，`locale-parity` 通过。

**诚实指标**：`mode` 恒为 `static_contract`，`estimated_cost_usd` 与 `avg_steps`
**留 NULL**，界面显示「静态契约评测，未真实执行，无成本与平均 Step 数据」。
不填 0 的理由是 M7 已因同类问题记 🟡（指标定义了但无数据源、序列恒为 0）——
一个恒为 0 的指标比 `NULL` 更有害，因为它看起来像真的。

实测门禁：后端全量 `pytest` **714 收集 / 713 passed + 1 skipped，退出码 0**
（新增 `tests/unit/test_skill_evaluation.py` 9 例、
`tests/integration/test_skills_api.py` 4 例，其中 2 例新增）；`ruff check app/ tests/` 通过、
`mypy app/` 125 文件无问题；`pnpm typecheck` 6/6、`pnpm lint` 3/3、`pnpm format:check`
（改动文件）通过、`pnpm test:unit` 全绿（ui 17 / mobile 52 / desktop 332 / core 137 / web 215）。

> ⚠️ **评测是静态契约检查，不是真实执行**。phase-7 §11.3 想要的「成功率、成本、平均
> Step、错误恢复」测不出来，因为 Skill 还没有运行时消费者（M13）。真实执行面落地后，
> 本节的 `mode` 需要出现 `executed` 的行，届时才有这四个指标。已登记为 S29。

### 2.11 Wave 2 工具（2026-10-03 交付，Phase 6 / M11）

提交 `b839db5`（OCR + DOCX/XLSX/PPTX 生成）、`493fefa`（二进制产物持久化与 Unicode 文件名）、
`c9350ea`（桌面端经执行节点读系统剪贴板）。注册表新增 `image_ocr`、`docx_write`、
`xlsx_write`、`pptx_write`、`read_clipboard`（已在 `build_phase6_registry()` 实列出来核对）。

按 §2.8 的决策执行：OCR 复用知识入库的 RapidOCR 适配层，引擎未安装时返回 `degraded`
而不是把工具执行打成失败，测试注入假后端不下载权重；文档生成的文件名来自模型输出，
路径分隔符与穿越段在工具边界即拒绝；生成的字节必须能被 python-docx / openpyxl /
python-pptx 重新打开读回原文，数值单元格保留原生类型（否则表格求和与排序失效）；
剪贴板走执行节点通道，节点不在线明确报不可用。

`493fefa` 顺手修掉一个自 Phase 6 Wave 1 就存在的缺陷：`_safe_name` 的
`[^A-Za-z0-9._-]` 白名单会把 `测试报告.docx` 压成 `docx`，**所有中文名产物此前只显示
扩展名**。本轮新登记的 M11 相关债见 S30–S33。

---

### 2.12 三端真机/模拟器取证与由此暴露的 UI 缺陷（2026-10-04）

本轮目标是补齐 README 的界面证据，顺带发现了 7 项此前无人登记的 UI 缺陷（S35–S41）。
**它们全是「截图时才看见」的问题：单测、typecheck、CI 都不会报，只有真跑界面才暴露。**

已取得的运行证据：

| 端     | 证据                                                                 |
| ------ | -------------------------------------------------------------------- |
| Web    | 登录 → 新会话 → 真实流式回复 → 记忆中心 → 工具控制台 → 技能中心 6 屏 |
| 桌面端 | Electron 登录与对话 2 屏                                             |
| 移动端 | Android 模拟器登录与真实流式回复 2 屏（经 `adb reverse` 打真实后端） |

移动端能跑起来是本轮先解掉的一个构建阻塞：`android/build/generated/autolinking/` 里
残留的是 8 月另一个 checkout 的绝对路径，而 `package.json.sha` 让 Gradle 跳过重新生成，
于是 13 个模块全部以空目录被 include，报成 "No variants exist"。
**根因在缓存里的路径是旧的，不在用哪套自动链接实现**，排查过程见
[跨端排障记录](troubleshooting.md)。

截图规范（本轮与用户拍定，后续补图照此执行）：Web 端统一 1440×900 视口、**不用
`fullPage`** —— `fullPage` 把滚动区拼成长图，出图像两个界面拼接；内容超一屏时滚到
要展示的区域再截一屏。移动端按设备分辨率整屏截，桌面端整窗口截。

发现的缺陷：

| ID  | 端     | 现象                                                | 位置                                     |
| --- | ------ | --------------------------------------------------- | ---------------------------------------- |
| S35 | Web    | 「只读」徽章在工具名较长时被压成竖排单字            | `components/agent/ToolControlCenter.tsx` |
| S36 | Web    | 「建议保存为技能」标题与说明游离在所有卡片之外      | `components/agent/SkillCenter.tsx`       |
| S37 | Web    | 记忆中心无卡片容器，分类/状态两排同款 pill 语义不同 | `components/agent/MemoryCenter.tsx`      |
| S38 | 两端   | 流结束后会话列表仍在转圈                            | Web 侧栏与 `main/ConversationList.tsx`   |
| S39 | Mobile | 暗色模式模型选择器选中行浅底白字，不可读            | 模型切换面板                             |
| S40 | Mobile | 「联网搜索」按钮恒为 disabled                       | 移动端输入栏                             |
| S41 | Mobile | 新会话输入栏只有 4 个开关，会话内有 7 个            | 移动端输入栏                             |

S38 原本被当成移动端问题，比对 Web 截图后确认**侧栏同样在转**，所以修必须落在共享的
流状态判定上，只补移动端等于留一半。同理 S41 是移动端独有：Web 新会话欢迎页的 8 个
开关已核对齐全。

---

## 3. 前序阶段仍未关闭的验收项

这些来自 Phase 4/5/6，属于「代码已合并但不构成生产放行」的部分：

| 状态 | 阶段    | 条目                                                               |
| ---- | ------- | ------------------------------------------------------------------ |
| 🟡   | Phase 4 | Windows / macOS 安装包、代码签名、自动更新源与目标平台安装验收     |
| 🟡   | Phase 5 | 生产部署环境验收（本地真实栈演练通过不等于放行）                   |
| 🟡   | Phase 6 | 系统性安全测试：Prompt injection、审批后参数替换的系统性执行       |
| 🟡   | Phase 6 | Browser Worker 完整安全灰度                                        |
| 🟡   | Phase 6 | 真实外部 MCP 经 Web 控制中心 UI 的完整链路验收（后端链路已有证据） |
| 🟡   | 全局    | 生产部署环境验收                                                   |

### 3.1 2026-09-18 代码审计：此前未登记的缺口

对 Phase 1-7 的验收标准逐条比对源码（不信任文档自述状态）后新发现的缺口。
**这些此前没有任何记录**，`docs/phases/*.md` 与本文件都默认它们已完成。

图例：⬜ 未实现 · 🟡 部分实现

#### Phase 1 — FastAPI 后端

无缺口。7 条验收项全部可追溯到代码与测试。

#### Phase 2 — Web 端

| 状态 | 条目                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | ~~`packages/ui` 的 Phase 2 交付物从未创建~~ 2026-10-02 补齐 `styles/tokens.css`、`components/Button.tsx`、`components/MessageBubble.tsx` 与三份测试，覆盖率阈值同时加回，逐条证据见 §2.3。**`apps/web` 仍未 import 该包** —— 功能等价物留在 `apps/web/src/components/`，迁移属独立决策 |

#### Phase 3 — 移动端

| 状态 | 条目                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜   | 原生 Google Sign-In（§5.2）与 `POST /auth/google/native`（§17）未实现。`@react-native-google-signin/google-signin` 在 `package.json` 里但**从未被 import**，`login.tsx` 把 google 和 github 一样走浏览器流程。验收项「Google 原生」未达成 |
| ⬜   | §15.3 要求的 `useHydrateAuth`、`ChatInput` 单测不存在（三项只有一项）                                                                                                                                                                     |

#### Phase 4 — 桌面端

§3 此前只记了「安装包/签名/自动更新**未验收**」，以下是**功能与资产本身缺失**，性质不同：

| 状态 | 条目                                                                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜   | `yuanai://` 从未向操作系统注册：`apps/desktop/src` 无任何 `setAsDefaultProtocolClient`，`package.json` 的 build 段无 `protocols`。URL 解析器与 `second-instance`/`open-url` 处理都在，但没人认领这个 scheme，因此「深链接从浏览器唤起」「Linux `.desktop` 注册」「OAuth 回跳拉起应用」三条验收项无法通过 |
| ⬜   | `apps/desktop/electron-builder.yml`（§5.1）不存在；内联配置缺 icon、NSIS 安装器图标、mac `hardenedRuntime`/`entitlements`/麦克风与摄像头用途声明、deb/rpm 依赖（libsecret 等）、linux `MimeType`                                                                                                         |
| ⬜   | `apps/desktop/resources/`（§5.3）不存在：无应用/托盘/安装器图标与 `entitlements.mac.plist`；托盘图标目前借用 `apps/mobile/assets/icon.png`                                                                                                                                                               |

#### Phase 5 — Agent 运行时

| 状态 | 条目                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟡   | §14 可观测性指标**已实现**（2026-10-02，见 §2.4）：8 个具名指标定义在 `app/core/metrics.py`，`main.py:128` 暴露 `/metrics`。仅 `agent_estimated_cost_usd` 因 `run.estimated_cost_usd` 从未被累加而恒为 0                                         |
| 🟡   | token / 金额上限**在生产路径未生效**：`workers/agent_worker.py` 构造 `AgentCoordinator` 时未传 `budget=`，默认 `max_tokens=None`、`max_cost_usd=None`；限额代码只被单测覆盖。验收项「达到 token 或金额上限时可预测地停止」实际只对步数与时间成立 |
| ⬜   | §13.3 前端集成/E2E 测试**一个都没有**：无 AgentWorkspace 组件测试、无 `useAgentRun` hook 测试、无 agent E2E spec                                                                                                                                 |

#### Phase 6 — 工具与执行

| 状态 | 条目                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| ✅   | §10 Wave 2「图片 OCR 统一解析入口」**已实现**（2026-10-03，见 §2.11）：`image_ocr` 工具复用知识入库的 RapidOCR 适配层     |
| ✅   | §10 Wave 2「工作区文件生成 DOCX/XLSX/PPTX」**已实现**（2026-10-03，见 §2.11）：`docx_write` / `xlsx_write` / `pptx_write` |
| ✅   | §9.4「获取剪贴板内容」**已实现**（2026-10-03，见 §2.11）：`read_clipboard` 经执行节点通道，节点离线明确报不可用           |
| 🟡   | §12.1 缺 `GET /tool-executions/{id}` 快照；`/mcp-servers` 缺测试/启停/删除                                                |
| ⬜   | §13.3「Desktop 低于最小协议版本进入 `update_required`」未实现：该枚举值是死代码，从未被赋值，只做精确字符串拒绝，无测试   |

#### Phase 7 — 记忆/知识库/Skills/自动化

**这是最大的一簇。**2026-09-18 审计时控制面（CRUD + UI）完成而核心机制基本没做；
下表的状态列已按后续交付逐条更新，**条目文字保留当时的审计结论**便于回溯。

| 状态 | 条目                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | §4 记忆写入流程 / MemoryExtractor **已实现**（2026-09-29，见 §2.1）。原审计结论：`create_candidate` 的唯一调用点是用户手动 POST，没有从成功 Run 中抽取、没有 PII/敏感度分级、没有去重、没有冲突检测、没有自动激活策略                        |
| ✅   | pgvector 与 §5.1 RRF 混合检索**已实现**（2026-09-29，见 §2.1）。原审计结论：两处 embedding 都是 `JSON` 列，检索是 Python 内存里的 `(关键词重合 + 余弦)/2` 全量打分，RRF 与 rerank 不存在。**知识库侧仍有 S26**（启用向量后反而不过滤）       |
| ✅   | §6.1 知识入库流水线**已实现**（2026-10-02，见 §2.5）。原审计结论：只有文本规范化 + 固定长度分块，无 OCR、无 PDF/Office/表格/代码解析、无结构感知分块、无质量检查                                                                             |
| ✅   | §8.2 Webhook 触发**已实现**（2026-10-03，见 §2.9）。原审计结论：触发类型只有 `once                                                                                                                                                           | cron`，全仓 `webhook`**0 命中**，无`/webhooks/{public_id}` 路由 |
| 🟡   | §3.3-3.6 的表：`ingestion_jobs`（§2.5）、`webhook_endpoints`（§2.9）、`skill_evaluations`（§2.10）**已建**；`skill_tool_requirements` 仍未建（声明工具目前存在 `skill_versions.required_tools` 的 JSON 列里），`assistant_personas` 见 §5 N1 |
| 🟡   | §7.3「从经验生成 Skill」与 §11.3「评测不通过不得替换 active 版本」**已实现**（2026-10-03，见 §2.10）。评测取静态契约检查，§11.3 的「成功率 / 成本 / 平均 Step」仍测不出来（M13 / S29）                                                       |
| ✅   | §5.3 本地记忆**已不再静默过滤**（2026-09-29，见 §2.1 / S2）：路由到在线桌面节点，节点离线时明确提示不可用。节点永久丢失后的强制删除通道仍缺（S23）                                                                                           |
| 🟡   | §10 API 缺口：记忆导出已实现（S5）、knowledge-sources/documents 生命周期端点已实现（§2.5）；游标分页仍只覆盖部分接口（S4）、自动化「复制」仍缺（S10）                                                                                        |
| ⬜   | MemoryCenter 三层全无测试（组件 / hook / api），而另外三个 Center 都有                                                                                                                                                                       |

> 以上条目均为 2026-09-18 的**代码审计结论**，已逐条核对文件与行号；其中 pgvector、
> budget 未接线、`setAsDefaultProtocolClient` 缺失、`packages/ui` 空壳、webhook 0 命中
> 五项由当时会话二次复核确认。**状态列随后续交付更新**（✅ 的行附了交付章节号），
> 只有仍为 ⬜ / 🟡 的行才是待办。

---

## 4. 已有的真实运行证据（不等于生产放行）

- 本地自动化门禁全绿：根级运行时/类型/单元/集成/lint/格式/脚本/构建，后端串行 pytest + mypy + Ruff。
- 全量 Web E2E 66/66（Chromium + Mobile Safari）—— 使用受控路由 mock，**只能证明 UI 回归**。
- 真实 Linux Desktop E2E `3 passed (3.0m)`：配对、WSS challenge、本地审批、签名回调、ACK、
  取消确认、节点撤销、强制重启后任务重投与恰好一次完成、系统选择器文件授权→真实读取→未授权拒绝。
  2026-09-17 在真实后端栈上复跑通过（`3 passed (3.0m)`，0 skipped / 0 flaky）。
- 真实 provider 四步云链（搜索→提取→分析→报告）跑通并产出真实 Artifact。
- 本地真实栈演练：Worker 强制退出恢复、五分钟断线 SSE 重连重放、审批恢复/取消/幂等/租户隔离、
  执行节点重连风暴（3 节点 36 次并发重连）、结果级 spool 重放。
- 远程 CI 三项 job（Frontend / Web E2E smoke / Backend）全部通过。

---

## 5. 本次新增范围（2026-09-16 登记，2026-09-17 扩充）

用户确认的新能力。N1-N3 扩写进现有阶段，N4-N7 新开阶段编号：

| 编号 | 能力                                  | 落位                                                              | 设计文档 | 代码 |
| ---- | ------------------------------------- | ----------------------------------------------------------------- | -------- | ---- |
| N1   | 专属助手人格（Persona）               | [Phase 7 §3.6 / §8.5](phases/phase-7-memory-skills-automation.md) | ✅       | ⬜   |
| N2   | 助手形象（静态 + 音色 + 2D 动画表情） | [Phase 11 §6.5](phases/phase-11-personal-digital-twin.md)         | ✅       | ⬜   |
| N3   | 跨渠道机器人接入                      | [Phase 12 §7](phases/phase-12-open-ecosystem.md)                  | ✅       | ⬜   |
| N4   | 实时语音对话（全双工 + 打断）         | [Phase 11 §6.6](phases/phase-11-personal-digital-twin.md)         | ✅       | ⬜   |
| N5   | 实时视频对话与视觉理解                | [Phase 13](phases/phase-13-realtime-video.md)                     | ✅       | ⬜   |
| N6   | 终端 TUI 与本地执行节点               | [Phase 14](phases/phase-14-cli.md)                                | ✅       | ⬜   |
| N7   | 小程序端（Taro）                      | [Phase 15](phases/phase-15-miniprogram.md)                        | ✅       | ⬜   |

> **七项均只有设计文档，未开始编码。**

### N4 实时语音对话

用户选定：**自组 STT + LLM + TTS 流水线**（不用厂商端到端 Realtime 单体接口），
**后端签发短期凭证、媒体直连供应商**。该直连例外**只覆盖 STT/TTS 两条媒体腿**；
LLM 推理仍必须经 `ai_service.py`，否则模型路由、配额与审批全部失效。

### N5 实时视频对话

用户选定四项全做：用户摄像头视觉理解、屏幕共享视觉理解、助手侧画面复用 Phase 11 2D 形象、
通话录制与回放。**视频帧不适用 N4 的直连例外** —— 视觉理解属于模型推理，必须经
`ai_service.py`，因此帧走后端而非直连。

### N6 终端 TUI

用户选定：**客户端 + 本地执行节点**，Node/TypeScript 实现，**做成 TUI**（Ink）。
Hermes Agent 只作参考形态，按 Phase 5 D7 不 fork；命令名为 `yuanai` 而非 `hermes`。
不做 CI / 非交互模式，因此无 TTY 时高风险动作一律拒绝。

### N7 小程序端

用户选定 **Taro（React）**，能力范围是「**能在小程序上实现的都迁移过去**」，
因此阶段文档以能力矩阵形式列出可迁移 / 受限 / 不可迁移三类及其平台原因。

### N1 专属助手人格

在已有 `assistants` 表（`name` / `description` / `instructions` / `default_model` /
`autonomy_level` / `is_default`）之上扩展人格：口吻、边界、开场白、称呼、拒绝风格，
并与 Phase 7 记忆按 `assistant_id` 绑定（`memories.assistant_id` 已存在）。

### N2 助手形象

用户选定范围：**静态形象（上传或 AI 生成）+ TTS 音色 + 2D 动画表情（Live2D / 序列帧）**。
不做 3D 数字人与声音克隆。渲染只在 Web / Desktop，Mobile 首版降级为静态立绘。

### N3 跨渠道机器人

用户选定四个交付波次：

| 波次 | 渠道                       | 说明                          |
| ---- | -------------------------- | ----------------------------- |
| W1   | QQ（官方机器人 / OneBot）  | 先打通 adapter 抽象           |
| W2   | 飞书 / Lark                | 互动卡片天然适合做审批 UI     |
| W3   | 企业微信 + 钉钉            | 与飞书同类，复用 adapter 结构 |
| W4   | Telegram + Discord + Slack | 海外渠道，Bot API 成熟        |

---

## 6. 长期技术债

| 状态 | 条目                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | ~~`RUNNING.md` 与 `dev-guide.md`/`README.md` 重叠~~ 2026-09-17 收敛：`RUNNING.md` 630 行→索引存根，环境变量与移动端启动并入 `dev-guide.md`（顺带修正端口 5432→5433 的失同步）                                                                                        |
| ✅   | ~~`AGENTS.md` 与 `dev-standards.md` 规范重叠~~ 2026-09-17 收敛：630→417 行，五/六/七/八/九/十三 六节改为指针；顺带修正「Husky 在 commit 跑单测、push 跑集成测试」的错误描述                                                                                          |
| ✅   | ~~i18n 语言包无一致性门禁~~ 2026-09-17 补齐：Web/Desktop 共用的 `zh-CN.json` / `en.json` 由 `apps/web/src/i18n/__tests__/locale-parity.test.ts` 守键集一致与空值；Mobile 的 `enUS: MobileMessages = DeepStringify<typeof zhCN>` 本就由 TS 保证。随 `test:unit` 进 CI |
| ✅   | ~~无覆盖率门禁~~ 2026-09-17 补齐：CI 新增 `pnpm test:coverage` 与 `pnpm test:scripts`；web/desktop/core 的阈值改为**取当前实测值的防退化棘轮**（web 44/50/70/44、desktop 81/64/75/81、core 42/68/75/42），原先 70-80 的阈值从未被执行过，属纸面数字                  |
| ✅   | ~~Husky `pre-push` 只跑 `typecheck` + `test:unit`~~ 2026-09-17 补齐：扩为 `typecheck` → `lint` → `format:check` → `test:unit` → 后端 Ruff/mypy/单测（检测到 `uv` 与 `backend/.venv` 才跑，否则跳过并提示）。后端集成测试仍留给 CI（需 docker compose）               |
| 🟡   | **硬编码文案仍无检测**：上一条只保证两份语言包结构一致，不阻止组件里直接写中文。实测 `apps/web/src` 有 61 个文件、458 行含中文字面量，加 `no-literal-string` 类规则等于一次 i18n 迁移工程，未在本次范围内                                                            |
| ✅   | ~~`packages/ui` 无任何单元测试（0 测试文件），覆盖率恒为 0%，已移除其纸面阈值~~ 2026-10-02 补齐 17 条用例，阈值按实测值（100/100/100/100）写回，见 §2.3                                                                                                              |
| 🟡   | 覆盖率棘轮阈值远低于目标（web/core 行覆盖仅 4x%），只防退化不代表覆盖充分                                                                                                                                                                                            |
| 🟡   | `apps/mobile` 未纳入覆盖率门禁：其 vitest 按设计只跑平台无关的纯 TS 模块，RN 组件需 Detox/RTL-native 另行覆盖，百分比不可比                                                                                                                                          |
| ⚪   | Mobile / Desktop 未接 Phase 7 控制界面（见 §2）                                                                                                                                                                                                                      |
