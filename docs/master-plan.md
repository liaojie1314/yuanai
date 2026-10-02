# 元AI 交付状态总表

> **本文件是「还有什么没做」的唯一真源。**
> `README.md`、`CLAUDE.md`、`AGENTS.md` 只做能力概述，`docs/phases/*.md` 只描述该阶段应该做成
> 什么样，`docs/superpowers/plans/*.md` 是一次性执行脚本 —— **都不是真源**。
> 新发现的待实现项与主动留下的技术债，**当次登记到这里**：别的会话不知道本会话发现了什么，
> 漏登记等于永久丢失。

**图例**：✅ 已交付 · 🟡 已交付但有未关闭的验收项 · ⬜ 未开工（仅有阶段文档）

**最后更新**：2026-09-18

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
| M3  | 7    | 知识入库流水线：多格式解析、OCR、结构感知分块、`ingestion_jobs`、质量检查             | ⬜   | §3.1  |
| M4  | 7    | Webhook 触发：`webhook_endpoints`、`/webhooks/{public_id}`、签名/重放/限流            | ⬜   | §3.1  |
| M5  | 7    | Skill 评测门禁 `skill_evaluations`（不通过不替换 active）+ 从经验生成 Skill           | ⬜   | §3.1  |
| M6  | 7    | 专属助手人格 Persona（复用 `memories.assistant_id` 隔离，人格不提权）                 | ⬜   | §5 N1 |
| M7  | 5    | 可观测性：8 个具名指标 + `/metrics` 暴露                                              | ⬜   | §3.1  |
| M8  | 4    | `yuanai://` 向系统注册 + `electron-builder.yml` + `resources/` 打包资产               | ⬜   | §3.1  |
| M9  | 3    | 原生 Google Sign-In + `POST /auth/google/native`                                      | ⬜   | §3.1  |
| M10 | 2    | `packages/ui` 组件库：`tokens.css` + `Button` + `MessageBubble` + 测试                | ✅   | §2.3  |
| M11 | 6    | Wave 2 补齐：图片 OCR、DOCX/XLSX/PPTX 生成、剪贴板工具                                | ⬜   | §3.1  |

### 小任务（S）

| ID  | 阶段 | 条目                                                                | 状态 | 详情 |
| --- | ---- | ------------------------------------------------------------------- | ---- | ---- |
| S1  | 5    | `agent_worker` 构造 Coordinator 时传 `budget=`，并加 config 键      | 🟡   | §3.1 |
| S2  | 7    | `local_node` 记忆不再静默过滤：路由到在线节点或明确提示不可用       | ✅   | §2.1 |
| S3  | 7    | MemoryCenter 三层测试（组件 / hook / api）                          | ⬜   | §2   |
| S4  | 7    | Phase 7 列表接口游标分页                                            | 🟡   | §2.1 |
| S5  | 7    | 记忆导出 API                                                        | ✅   | §2.1 |
| S6  | 6    | `GET /tool-executions/{id}`；`/mcp-servers` 测试 / 启停 / 删除      | ⬜   | §3.1 |
| S7  | 6    | `update_required` 节点状态接线 + 测试（当前是死枚举）               | ⬜   | §3.1 |
| S8  | 3    | `useHydrateAuth` / `ChatInput` 单测                                 | ⬜   | §3.1 |
| S9  | 5    | 前端 Agent 测试：组件 + hook + E2E                                  | ⬜   | §3.1 |
| S10 | 7    | 自动化「复制」                                                      | ⬜   | §3.1 |
| S11 | —    | `packages/ui` 补测试后加回覆盖率阈值                                | ✅   | §2.3 |
| S12 | 7    | 记忆检索评测集（Recall@K / MRR / 引用准确率）                       | ✅   | §2.1 |
| S13 | —    | 硬编码文案检测（61 文件 / 458 行，等于一次 i18n 迁移）              | ⬜   | §6   |
| S14 | 7    | Mobile / Desktop 侧 Phase 7 控制界面                                | ⬜   | §2   |
| S15 | 7    | 知识库检索的中文长查询静默退化（声明 10000 字，FTS 实为 2046 字节） | ⬜   | §2.2 |
| S16 | 7    | 检索仍顶 `updated_at`：响应字段对用户撒谎 + 污染新鲜度排序          | ⬜   | §2.2 |
| S17 | 7    | 记忆导出不含本机正文，文件永远无法完整还原本地记忆                  | ⬜   | §2.2 |
| S18 | 2    | Web 不渲染后端 detail 码，记忆增删改的错误全显示「操作失败」        | ⬜   | §2.2 |
| S19 | 2    | `ChatInterface.tsx` 2600+ 行无渲染测试（仅纯函数测试）              | ⬜   | §2.2 |
| S20 | 5    | `agent_steps.output_json` 是死列，drop 属独立迁移决策               | ⬜   | §2.2 |
| S21 | —    | `feature/memory-extraction-hybrid-search` 全分支 review 未完成      | ✅   | §2.2 |
| S22 | 7    | 向量臂无相关度下限：余弦 −1 的查询照样满分召回全部记忆              | ⬜   | §2.2 |
| S23 | 7    | 执行节点永久丢失后，`local_node` 记忆永远删不掉，无强制通道         | ⬜   | §2.2 |
| S24 | 6    | `run_node_job` 内部 `commit()` 会连带提交调用方的未提交改动         | ⬜   | §2.2 |

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
| Phase 5  | Agent 运行时与任务状态机             | 🟡   | 指标未实现、token/金额预算未接线（§3.1）                 |
| Phase 6  | 工具系统、MCP、沙箱、执行节点        | 🟡   | Wave 2 若干项与协议版本门未做（§3.1）                    |
| Phase 7  | 记忆、知识库、Skills、自动化         | 🟡   | **控制面已落地，核心机制未实现**（§2 更正、§3.1）        |
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
> 见 §2.1；其余四项（§6.1 知识入库、§7.3 从经验生成 Skill、§8.2 Webhook、§11.3 Skill 评测门禁）
> 仍未实现，对应 §0 的 M3 / M4 / M5，状态不变。

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

| ID  | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S15 | **中文长查询静默退化**。实测 `plainto_tsquery('simple', …)` 在 **2046 字节（约 682 汉字）** 处退化成空查询：678 字仍可用、684 字起为空，**无异常、无日志**。记忆检索已把上限统一压到 500 字避开它，但**知识库检索仍声明 10000 字**，中文长查询会无声返回空结果。与中文分词债同根                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S16 | **检索会顶 `updated_at`**。`memory_retrieval.py` 在 ORM 实例上写 `last_used_at` 后 flush，触发 `models/memory.py` 的 `onupdate=func.now()`。分页排序键已改为不可变的 `created_at`（见发现 M），**不再丢数据**；但 `MemoryResponse.updated_at` 仍对用户撒谎（只读了一下却显示「刚修改」），并污染检索关键词臂的新鲜度排序 —— 关键词臂的次级排序键正是 `updated_at`，而两字中文查询下 `word_similarity` 对所有行恒为 0（见同文件 ponytail 注释），此时**整个关键词排序退化成 `updated_at DESC`**，于是上一次检索的赢家被钉在队首反复召回，形成赢者通吃的正反馈。最小修法：用 Core `UPDATE` 显式写 `updated_at=Memory.updated_at` 压掉 `onupdate`                                                                                                        |
| S17 | **导出不含本机正文**。节点在线时 `localUnavailable` 为 `false`，但 `local_node` 条目的 `content` 依旧是 `null` —— 这份文件**永远不足以完整还原本机记忆**。已写进 schema docstring 与 TS JSDoc。真正的修法（导出时向节点批量取回）属新功能                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S18 | **Web 不渲染后端 detail 码**。记忆的创建/更新/删除错误在前端没有任何出口，新加的 `504 LOCAL_MEMORY_APPROVAL_TIMEOUT` 对网页用户只表现为「操作失败」，用户无从知道是自己审批超时                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S19 | **`ChatInterface.tsx` 2600+ 行却只有纯函数测试**，模型目录的加载态与失败态在 web 侧无渲染测试（逻辑覆盖做在 `packages/core`，desktop 有渲染测试）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S20 | **`agent_steps.output_json` 是死列**。API 字段已移除（`28e6a14`），数据库列保留，drop 属独立迁移决策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S21 | ✅ **全分支 review 已完成**（2026-10-01）。前两次派出的审查都被基础设施配额错误（HTTP 402）中断，改由主会话逐面手查，五个面全覆盖：隐私边界（查出并修掉 `source_excerpt`/`structured_data` 绕道上云，`625153e` + `3b9c59a`）、游标健壮性（四类畸形输入均被单个 `except ValueError` 兜住）、异常吞底（新代码无 `except Exception`）、检索融合（查出并修掉节点分数霸榜，`f68ea9c`；另登记 S22）、节点存活与作业路由（`node_is_fresh` 直判 `last_seen_at`，不依赖 sweeper 跑过；无节点立刻 `unavailable` 并如实冒泡成 `localUnavailable`，不伪装成「没有记忆」；另登记 S23/S24）                                                                                                                                                                         |
| S22 | **向量臂没有相关度下限**。`_cloud_results` 的向量臂只有 `ORDER BY cosine_distance LIMIT recall`，没有任何距离阈值；而 RRF 只消费名次，首名无论距离多远都得 `1/(RRF_K+1)`。实测：存两条记忆后用与它们**正交**（余弦 0）乃至**反向**（余弦 −1）的查询向量检索，关键词臂零命中的情况下仍召回全部 2 条，分数 0.125 / 0.1071 —— 与完美匹配拿到的分数一模一样。两个线上调用点（`api/v1/memories.py:113`、`agent/coordinator.py:541`）都传 embedding，因此**只要库里有记忆，检索就永远不会返回空**，`coordinator` 会把这些无关记忆当成用户事实注入上下文；返回给客户端的 `score` 同样不含匹配质量信息。修法要定一个余弦阈值，需拿真实 embedding 模型在 `tests/integration/test_memory_retrieval_eval.py` 上标定精确率/召回率，拍数字属独立决策，不在本轮瞎猜 |
| S23 | **节点永久丢失则本地记忆永远删不掉**。`delete_memory` 对 `local_node` 记忆先调 `drop_local_memory`，节点不可用时抛错、整次删除失败（这是刻意的：好过把正文永久留在用户磁盘上）。但机器丢了或重装了的用户，这些记忆连同云端元数据**再也删不掉**，没有强制通道。真正的修法（带明确告知的强制删除，承认正文可能仍留在那台机器上）属新功能                                                                                                                                                                                                                                                                                                                                                                                                                |
| S24 | **`run_node_job` 内部会 `commit()`**。它必须提交执行记录才能让节点网关看见（`tool_runtime_service.py`），于是**连带提交调用方当时所有未提交的改动**。当前三个调用点都安全，但安全性全靠调用顺序：`create_candidate` 刻意把 `push_local_memory` 放在 `db.add` 之前，一次检索里 `_cloud_results` 写的 `last_used_at` 则会被本地臂的这次 commit 顺手提交。下一个在改了一半数据之后调用它的人会拿到静默的部分提交，而且不会有任何报错                                                                                                                                                                                                                                                                                                                     |

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
| ⬜   | §14 可观测性指标未实现：`services/agent/metrics.py` 是结构化**日志**，唯一调用点传的是 SSE 事件名而非指标名。8 个规定指标（`agent_runs_total` 等）均不存在，无标签、无 counter/histogram、`main.py` 无 `/metrics`                                |
| 🟡   | token / 金额上限**在生产路径未生效**：`workers/agent_worker.py` 构造 `AgentCoordinator` 时未传 `budget=`，默认 `max_tokens=None`、`max_cost_usd=None`；限额代码只被单测覆盖。验收项「达到 token 或金额上限时可预测地停止」实际只对步数与时间成立 |
| ⬜   | §13.3 前端集成/E2E 测试**一个都没有**：无 AgentWorkspace 组件测试、无 `useAgentRun` hook 测试、无 agent E2E spec                                                                                                                                 |

#### Phase 6 — 工具与执行

| 状态 | 条目                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 🟡   | §10 Wave 2「图片 OCR 统一解析入口」未实现：`file_extract_service.py` 对图片只返回空预览，全仓无 OCR 实现                |
| 🟡   | §10 Wave 2「工作区文件生成 DOCX/XLSX/PPTX」未实现：`files_write` 只写文本；python-docx 仅用于读取                       |
| 🟡   | §9.4 首批本地工具缺「获取剪贴板内容」                                                                                   |
| 🟡   | §12.1 缺 `GET /tool-executions/{id}` 快照；`/mcp-servers` 缺测试/启停/删除                                              |
| ⬜   | §13.3「Desktop 低于最小协议版本进入 `update_required`」未实现：该枚举值是死代码，从未被赋值，只做精确字符串拒绝，无测试 |

#### Phase 7 — 记忆/知识库/Skills/自动化

**这是最大的一簇。**控制面（CRUD + UI）确实完成，但文档描述的核心机制基本没做：

| 状态 | 条目                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜   | §4 记忆写入流程 / MemoryExtractor 不存在：`create_candidate` 的唯一调用点是用户手动 POST。没有从成功 Run 中抽取、没有 PII/敏感度分级、没有去重、没有冲突检测、没有自动激活策略、没有新事实覆盖旧事实                                                                 |
| ⬜   | pgvector 完全缺席：`memories.embedding` 与知识库 embedding 都是 `JSON` 列，检索是 Python 内存里的 `(关键词重合 + 余弦)/2` 全量打分（代码里已有 `ponytail:` 注释自陈待迁移）。§5.1 的 RRF 混合检索与 rerank 不存在，§12 验收项「pgvector + FTS 混合检索」结构上不可达 |
| ⬜   | §6.1 知识入库流水线不存在：只有文本规范化 + 固定长度分块。无病毒扫描、无 OCR、无 PDF/Office/表格/代码解析、无结构感知分块、无质量检查；唯一来源类型是 `text`                                                                                                         |
| ⬜   | §8.2 Webhook 触发完全缺席：触发类型只有 `once                                                                                                                                                                                                                        | cron`，全仓 `webhook`**0 命中**，无`/webhooks/{public_id}` 路由 |
| ⬜   | §3.3-3.6 的表未建：`ingestion_jobs`、`skill_tool_requirements`、`skill_evaluations`、`webhook_endpoints`（`assistant_personas` 见 §5 N1）                                                                                                                            |
| ⬜   | §7.3「从经验生成 Skill」不存在；§11.3「评测不通过不得替换 active 版本」不存在（校验只做 manifest schema 与风险上限）                                                                                                                                                 |
| ⬜   | §5.3 本地记忆：`storage_location == local_node` 的记忆被检索**直接静默过滤**，既没有路由到在线桌面节点，也没有「本地私密记忆暂不可用」的提示                                                                                                                         |
| ⬜   | §10 API 缺口：记忆导出、Phase 7 全部列表接口的游标分页、knowledge-sources/documents 生命周期端点、自动化「复制」                                                                                                                                                     |
| ⬜   | MemoryCenter 三层全无测试（组件 / hook / api），而另外三个 Center 都有                                                                                                                                                                                               |

> 以上条目均为**代码审计结论**，已逐条核对文件与行号；其中 pgvector、budget 未接线、
> `setAsDefaultProtocolClient` 缺失、`packages/ui` 空壳、webhook 0 命中五项由本会话二次复核确认。

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
