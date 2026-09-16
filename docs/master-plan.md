# 元AI 交付状态总表

> **本文件是「还有什么没做」的唯一真源。**
> `README.md`、`CLAUDE.md`、`AGENTS.md` 只做能力概述，`docs/phases/*.md` 只描述该阶段应该做成
> 什么样，`docs/superpowers/plans/*.md` 是一次性执行脚本 —— **都不是真源**。
> 新发现的待实现项与主动留下的技术债，**当次登记到这里**：别的会话不知道本会话发现了什么，
> 漏登记等于永久丢失。

**图例**：✅ 已交付 · 🟡 已交付但有未关闭的验收项 · ⬜ 未开工（仅有阶段文档）

**最后更新**：2026-09-16

---

## 1. 阶段状态总表

| 阶段     | 主题                             | 状态 | 说明                                                 |
| -------- | -------------------------------- | ---- | ---------------------------------------------------- |
| Phase 0  | Monorepo 脚手架                  | ✅   | Turborepo + pnpm + 三端骨架                          |
| Phase 1  | FastAPI 后端核心                 | ✅   | 认证、会话、消息、SSE、文件                          |
| Phase 2  | Next.js Web 端                   | ✅   | 完整聊天与设置                                       |
| Phase 3  | Expo React Native 移动端         | ✅   | 已合入 `dev`                                         |
| Phase 4  | Electron 桌面端                  | 🟡   | 功能完整；Windows/macOS 安装包、签名、自动更新未验收 |
| Phase 5  | Agent 运行时与任务状态机         | 🟡   | 已合入 `dev`；生产部署环境验收未完成                 |
| Phase 6  | 工具系统、MCP、沙箱、执行节点    | 🟡   | 已合入 `dev`；系统性安全测试与生产验收未完成         |
| Phase 7  | 记忆、知识库、Skills、自动化     | 🟡   | **代码与测试已落地**；人格（Persona）为本次新增范围  |
| Phase 8  | 治理、控制中心、运营后台、可观测 | ⬜   | 仅有阶段文档                                         |
| Phase 9  | 生活/学习/工作空间与连接器       | ⬜   | 仅有阶段文档                                         |
| Phase 10 | 自主性、委派与评测               | ⬜   | 仅有阶段文档                                         |
| Phase 11 | 个人数字孪生（含助手形象）       | ⬜   | 仅有阶段文档；形象为本次新增范围                     |
| Phase 12 | 开放生态（含跨渠道机器人）       | ⬜   | 仅有阶段文档；机器人章节为本次扩写                   |

---

## 2. Phase 7 — 已落地的代码面

2026-09-15 核对当前 checkout，Phase 7 主干能力**已实现并有自动化测试**，不再是「尚未开始」。

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
| Web 测试 | `components/__tests__/{KnowledgeCenter,SkillCenter,AutomationCenter}.test.tsx`                                                                                      |

> ⚠️ 上述为**代码存在性核对**，本次会话未复跑测试套件。真实栈端到端验收状态见 §4。

### Phase 7 未关闭项

| 状态 | 条目                                                                      |
| ---- | ------------------------------------------------------------------------- |
| 🟡   | 本次未复跑后端 pytest / Web vitest，交付前需跑一遍确认全绿                |
| 🟡   | 记忆检索评测（Phase 7 文档 §11.2）未见评测集与指标产出                    |
| 🟡   | Mobile / Desktop 侧的记忆、知识库、Skills、自动化控制界面未实现（仅 Web） |
| ⬜   | **专属助手人格（Persona）** —— 本次新增范围，见 §5                        |

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

---

## 4. 已有的真实运行证据（不等于生产放行）

- 本地自动化门禁全绿：根级运行时/类型/单元/集成/lint/格式/脚本/构建，后端串行 pytest + mypy + Ruff。
- 全量 Web E2E 66/66（Chromium + Mobile Safari）—— 使用受控路由 mock，**只能证明 UI 回归**。
- 真实 Linux Desktop E2E `3 passed (3.0m)`：配对、WSS challenge、本地审批、签名回调、ACK、
  取消确认、节点撤销、强制重启后任务重投与恰好一次完成、系统选择器文件授权→真实读取→未授权拒绝。
- 真实 provider 四步云链（搜索→提取→分析→报告）跑通并产出真实 Artifact。
- 本地真实栈演练：Worker 强制退出恢复、五分钟断线 SSE 重连重放、审批恢复/取消/幂等/租户隔离、
  执行节点重连风暴（3 节点 36 次并发重连）、结果级 spool 重放。
- 远程 CI 三项 job（Frontend / Web E2E smoke / Backend）全部通过。

---

## 5. 本次新增范围（2026-09-16 登记）

用户确认的新能力，**不新增阶段编号**，扩写进现有阶段：

| 编号 | 能力                                  | 落位                                                              | 设计文档 | 代码 |
| ---- | ------------------------------------- | ----------------------------------------------------------------- | -------- | ---- |
| N1   | 专属助手人格（Persona）               | [Phase 7 §3.6 / §8.5](phases/phase-7-memory-skills-automation.md) | ✅       | ⬜   |
| N2   | 助手形象（静态 + 音色 + 2D 动画表情） | [Phase 11 §6.5](phases/phase-11-personal-digital-twin.md)         | ✅       | ⬜   |
| N3   | 跨渠道机器人接入                      | [Phase 12 §7](phases/phase-12-open-ecosystem.md)                  | ✅       | ⬜   |

> 设计文档已于 2026-09-16 写入对应阶段文档；**三项均未开始编码**。

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

| 状态 | 条目                                                                            |
| ---- | ------------------------------------------------------------------------------- |
| 🟡   | `RUNNING.md`（17K）与 `docs/dev-guide.md`、`README.md` 启动说明存在重叠，待收敛 |
| 🟡   | `AGENTS.md`（26K）与 `CLAUDE.md`、`docs/dev-standards.md` 规范内容重叠          |
| 🟡   | 无 i18n 门禁：UI 文案硬编码中文，多语言未规划                                   |
| 🟡   | 无覆盖率门禁（CI 只跑 lint/typecheck/test，不校验覆盖率阈值）                   |
| ⚪   | Mobile / Desktop 未接 Phase 7 控制界面（见 §2）                                 |
