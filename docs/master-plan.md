# 元AI 交付状态总表

> **本文件是「还有什么没做」的唯一真源。**
> `README.md`、`CLAUDE.md`、`AGENTS.md` 只做能力概述，`docs/phases/*.md` 只描述该阶段应该做成
> 什么样，`docs/superpowers/plans/*.md` 是一次性执行脚本 —— **都不是真源**。
> 新发现的待实现项与主动留下的技术债，**当次登记到这里**：别的会话不知道本会话发现了什么，
> 漏登记等于永久丢失。

**图例**：✅ 已交付 · 🟡 已交付但有未关闭的验收项 · ⬜ 未开工（仅有阶段文档）

**最后更新**：2026-09-18

---

## 1. 阶段状态总表

| 阶段     | 主题                                 | 状态 | 说明                                               |
| -------- | ------------------------------------ | ---- | -------------------------------------------------- |
| Phase 0  | Monorepo 脚手架                      | ✅   | Turborepo + pnpm + 三端骨架                        |
| Phase 1  | FastAPI 后端核心                     | ✅   | 认证、会话、消息、SSE、文件；审计无缺口            |
| Phase 2  | Next.js Web 端                       | 🟡   | 功能验收通过；`packages/ui` 交付物从未创建（§3.1） |
| Phase 3  | Expo React Native 移动端             | 🟡   | 已合入 `dev`；原生 Google 登录未实现（§3.1）       |
| Phase 4  | Electron 桌面端                      | 🟡   | `yuanai://` 未向系统注册、打包资产缺失（§3.1）     |
| Phase 5  | Agent 运行时与任务状态机             | 🟡   | 指标未实现、token/金额预算未接线（§3.1）           |
| Phase 6  | 工具系统、MCP、沙箱、执行节点        | 🟡   | Wave 2 若干项与协议版本门未做（§3.1）              |
| Phase 7  | 记忆、知识库、Skills、自动化         | 🟡   | **控制面已落地，核心机制未实现**（§2 更正、§3.1）  |
| Phase 8  | 治理、控制中心、运营后台、可观测     | ⬜   | 仅有阶段文档                                       |
| Phase 9  | 生活/学习/工作空间与连接器           | ⬜   | 仅有阶段文档                                       |
| Phase 10 | 自主性、委派与评测                   | ⬜   | 仅有阶段文档                                       |
| Phase 11 | 个人数字孪生（含助手形象、实时语音） | ⬜   | 仅有阶段文档；形象与实时语音为本次新增范围         |
| Phase 12 | 开放生态（含跨渠道机器人）           | ⬜   | 仅有阶段文档；机器人章节为本次扩写                 |
| Phase 13 | 实时视频对话与视觉理解               | ⬜   | **本次新增阶段**，仅有阶段文档                     |
| Phase 14 | 终端 TUI 与本地执行节点              | ⬜   | **本次新增阶段**，仅有阶段文档                     |
| Phase 15 | 小程序端（Taro）                     | ⬜   | **本次新增阶段**，仅有阶段文档                     |

---

## 2. Phase 7 — 已落地的代码面

2026-09-15 核对当前 checkout，Phase 7 的**控制面**（数据模型、CRUD API、共享层、Web UI）
已实现并有自动化测试，不再是「尚未开始」。

> ⚠️ **2026-09-18 代码审计更正**：此前本节写的是「Phase 7 主干能力已实现」，**这个说法过宽**。
> 已实现的是「增删改查 + 界面」的控制面；Phase 7 文档 §4（记忆写入流程）、§5.1（混合检索）、
> §6.1（知识入库流水线）、§7.3（从经验生成 Skill）、§8.2（Webhook 触发）、§11.3（Skill 评测门禁）
> 所描述的**核心机制尚未实现**。逐条见 §3.1。

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

| 状态 | 条目                                                                                                                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⬜   | `packages/ui` 的 Phase 2 交付物从未创建：缺 `styles/tokens.css`、`components/Button.tsx`、`components/MessageBubble.tsx`。该包 `src/` 下只有 `index.ts` / `lib/cn.ts` / `styles/globals.css`；`apps/web` 声明了依赖但没有任何文件 import 它。功能等价物写在 `apps/web/src/components/`，因此 11 条验收项仍然通过 —— 缺的是**共享组件库本身** |

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
| 🟡   | `packages/ui` 无任何单元测试（0 测试文件），覆盖率恒为 0%，已移除其纸面阈值；补测试时需同时加回                                                                                                                                                                      |
| 🟡   | 覆盖率棘轮阈值远低于目标（web/core 行覆盖仅 4x%），只防退化不代表覆盖充分                                                                                                                                                                                            |
| 🟡   | `apps/mobile` 未纳入覆盖率门禁：其 vitest 按设计只跑平台无关的纯 TS 模块，RN 组件需 Detox/RTL-native 另行覆盖，百分比不可比                                                                                                                                          |
| ⚪   | Mobile / Desktop 未接 Phase 7 控制界面（见 §2）                                                                                                                                                                                                                      |
