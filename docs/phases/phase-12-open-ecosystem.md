# Phase 12 - 开放 Skill/Connector 生态、跨渠道助理与可信 Agent 协作

- **前置条件**：Phase 11 主动助理达到准确率、隐私和打扰门禁
- **建议分支**：`feat/phase-12-open-ecosystem`
- **执行范围**：Plugin SDK、Skill Hub、Connector 生态、消息渠道、外部 Agent 协议、自托管与供应链安全
- **阶段定位**：让 yuanai 从单一产品扩展为可信的个人 Agent 能力平台，同时保持用户数据与权限主权

---

## 1. 产品目标

1. 第三方可以开发 Skill、Connector、MCP 和场景模板，而不 fork 主仓库
2. 用户可以在 Web、Mobile、Desktop、邮件和消息渠道访问同一个助理
3. yuanai 可以把受限子任务委派给外部 Agent 服务，但不交出用户全部上下文和权限
4. 社区版/自托管与云服务保持协议兼容，用户可以导出和迁移数据
5. 建立签名、审核、权限、隔离、撤回和供应链响应体系

### 1.1 非目标

- 不允许市场插件在 yuanai API 进程中运行任意代码
- 不允许 Skill 安装时默认获得全部工具、记忆和连接
- 不允许外部 Agent 代表用户自行购买权限或转委派
- 不用下载量和评分替代安全审核
- 不创建不可迁移的私有 Agent 身份和用户画像锁定

---

## 2. 扩展类型

| 类型           | 内容                                   | 执行方式                | 主要风险              |
| -------------- | -------------------------------------- | ----------------------- | --------------------- |
| Skill          | 指令、模板、schema、评测和工具依赖     | yuanai Runtime          | Prompt/流程投毒       |
| Scene Pack     | Workspace、Skill、自动化和 UI 配置组合 | yuanai Runtime          | 过度授权              |
| Connector      | OAuth、事件订阅和标准工具              | 隔离 Connector Worker   | 凭证与数据外传        |
| MCP Server     | 外部工具服务                           | 远程或隔离节点          | schema 变化、恶意工具 |
| UI Extension   | 设置/Artifact 的受控组件               | 沙箱 iframe 或声明式 UI | XSS、钓鱼             |
| External Agent | 接收明确子任务并返回结构化结果         | 远程 A2A adapter        | 上下文泄漏与不可审计  |

扩展必须声明最小能力；用户安装扩展不等于启用其全部权限。

---

## 3. Extension Manifest

```yaml
id: com.example.travel-planner
version: 2.1.0
publisher: example
type: scene_pack
display_name: Travel Planner
description: 研究并生成可编辑旅行计划
license: MIT
runtime_api: '>=1.2 <2'
permissions:
  data:
    - workspace:read
  tools:
    - yuanai.web.search@^1
    - yuanai.web.extract@^1
  connections:
    - calendar.read
risk_ceiling: read
entrypoints:
  skill: SKILL.md
  scene: scene.yaml
artifacts:
  - itinerary
signing:
  publisher_key_id: key-2026-01
```

Manifest、文件列表和依赖生成 canonical hash，由发布者签名。平台再附加审核签名。

---

## 4. Plugin SDK

### 4.1 SDK 边界

- JSON Schema/Pydantic/TypeScript 类型生成
- Tool/Connector/MCP adapter 接口
- 本地模拟器和测试账号夹具
- Policy/Approval 测试工具
- Eval Runner 和 Golden Task 格式
- 打包、SBOM、签名和发布 CLI
- 兼容性检查和迁移脚本

SDK 不暴露数据库 Session、SecretStore master key、内部 Redis 或管理员 API。

### 4.2 版本兼容

- Runtime API 使用 semantic version
- manifest 声明范围，安装前静态检查
- 弃用至少跨两个 minor release 提示
- 破坏性变更提供自动迁移或并行旧 runtime
- 云端和自托管实例都可运行兼容性测试

---

## 5. Skill Hub 与市场

### 5.1 页面

- 搜索、分类、场景、所需连接、风险、价格/许可证
- 安装前权限差异和数据位置说明
- 版本历史、评测结果、发布者、源码和安全记录
- 已安装扩展的更新、回滚、禁用和删除

### 5.2 发布流程

```text
Publisher Verify
 -> Package + SBOM + Signature
 -> Static Scan
 -> Sandbox Tests
 -> Permission Review
 -> Safety/Quality Evals
 -> Human Review（高风险）
 -> Staged Publish
 -> Runtime Monitoring
```

更新如果新增权限、连接、域名或提高 risk ceiling，必须重新向用户授权，不能静默升级。

### 5.3 评价体系

- 评分只来自真实安装且防刷
- 展示成功率、平均成本和兼容版本的聚合范围，不泄露用户任务
- 安全事件和被撤回版本必须公开说明
- “推荐”排序综合质量、安全、维护状态和用户适配，不按付费竞价隐藏风险

### 5.4 商业化边界

在实现付费市场前必须单独确认许可证、税务、退款、内容责任、收入分成和地区合规。Phase 12 可以先交付免费/私有 Hub；付费不是阶段验收硬门槛。

---

## 6. 供应链安全

### 6.1 强制措施

- 发布者身份和签名密钥
- 包内容哈希、SBOM、依赖漏洞与恶意代码扫描
- 构建来源证明，优先可复现构建
- Connector 容器最小权限、只读文件系统和受控 egress
- UI Extension 使用 sandbox iframe、严格 CSP 和消息 schema
- Skill 文本执行 Prompt injection 扫描与红队评测

### 6.2 撤回

- 平台可按 extension/version/hash 紧急禁用
- 已安装实例通过 signed advisory 获取撤回信息
- 高危版本阻止新 Run 并暂停相关自动化
- 用户看到原因、影响和替代/导出路径
- 撤回本身写入审计，不删除历史执行证据

### 6.3 自托管

自托管实例可选择官方 advisory feed；即使关闭自动更新，也应明确展示高危告警和受影响版本。

---

## 7. 跨渠道机器人接入

把助理投放到用户已经在用的聊天工具里。**渠道 adapter 只负责收发、身份映射、附件与平台交互；
Agent Runtime、Run、记忆、审批和预算仍然只在核心服务**，渠道侧不持有任何决策权。

### 7.1 交付波次

| 波次 | 渠道                       | 接入方式                                             | 目标                                 |
| ---- | -------------------------- | ---------------------------------------------------- | ------------------------------------ |
| W1   | QQ                         | QQ 官方机器人开放平台；自托管场景支持 OneBot v11/v12 | 打通 adapter 抽象，验证接口是否合理  |
| W2   | 飞书 / Lark                | 开放平台自建应用 + 事件订阅 + 互动卡片               | 用互动卡片承载审批 UI                |
| W3   | 企业微信 + 钉钉            | 自建应用 + 回调                                      | 复用 W2 的卡片与审批结构             |
| W4   | Telegram + Discord + Slack | Bot API / Bot Token                                  | 海外渠道，验证抽象对非中式 IM 的适配 |

W1 只做私聊与最小能力集；群聊、卡片审批、附件从 W2 起逐步开放。
Email、Webhook/API client、语音入口与系统分享菜单不在本章，属于通用入口。

### 7.2 Channel Adapter 统一接口

所有渠道实现同一套接口，新增渠道不得修改核心服务：

```text
inbound:  渠道事件 -> 验签 -> 去重 -> 身份解析 -> 归一化 ChannelMessage -> 核心服务
outbound: 核心事件 -> 能力协商 -> 渠道格式渲染 -> 限流 -> 发送 -> 回执
```

归一化后的入站消息至少包含：渠道类型、渠道消息 ID、会话作用域（私聊/群）、
发送者渠道身份、文本、附件引用、时间戳、原始负载指纹。

Adapter **必须**实现：验签、幂等去重、身份解析、能力声明、格式渲染、限流退避、回执与错误上报。
Adapter **不得**：直接读写记忆、直接调用工具、绕过审批、自行决定模型。

### 7.3 数据模型

- `channel_apps`：渠道类型、应用凭据引用（存 Secret Store，不落库明文）、回调地址、启用状态
- `channel_bindings`：yuanai 用户 ↔ 渠道身份（渠道类型、渠道用户 ID、绑定时间、状态）
- `channel_conversations`：渠道会话 ↔ 内部 conversation/space 的映射与可见性策略
- `channel_messages`：渠道消息 ID ↔ 内部消息 ID，用于幂等与回执
- `channel_events`：入站事件去重表（渠道事件 ID + 指纹，带 TTL）

### 7.4 身份绑定与配对

- 绑定流程**必须从已登录的 yuanai 客户端发起**，生成一次性短时效配对码；
  用户在渠道内把配对码发给机器人完成绑定，反向流程（先在渠道发起）不予支持
- 私信默认仅响应已绑定用户；**不接受任意陌生人控制助理**
- 未绑定用户私聊时只返回引导文案与绑定入口，不进入 Agent Runtime
- 群聊按空间与频道单独配置，**默认不可访问个人私密记忆与个人连接器**
- 渠道账号解绑或被撤销后立即停止处理新消息；历史消息保留策略随用户设置
- 同一 yuanai 用户可绑定多个渠道身份；同一渠道身份不得绑定到多个 yuanai 账号

### 7.5 渠道内审批

高风险动作仍走统一审批，只是把审批卡片渲染到渠道：

- 支持互动组件的渠道（飞书卡片、企微/钉钉卡片、Telegram inline keyboard、
  Discord/Slack button）**可在渠道内完成低风险审批**
- 高风险动作（对外通信、资金、删除、权限扩张）**必须回主应用二次确认**，
  渠道内只提供安全深链接
- 多渠道同时操作同一审批使用**原子决定**：先到者生效，后续点击显示"已处理"
- 审批卡片必须展示：动作摘要、作用域、预算影响、发起来源、过期时间
- 审批链接与卡片回调必须带签名与有效期，过期即失效

### 7.6 能力降级矩阵

| 能力     | QQ     | 飞书/企微/钉钉 | Telegram | Discord  | Slack    |
| -------- | ------ | -------------- | -------- | -------- | -------- |
| 富文本   | 受限   | 卡片           | Markdown | Markdown | mrkdwn   |
| 互动按钮 | 受限   | ✅             | ✅       | ✅       | ✅       |
| 长文本   | 需分段 | 需分段         | 需分段   | 需分段   | 需分段   |
| 流式输出 | ❌     | ❌             | 编辑消息 | 编辑消息 | 编辑消息 |
| 附件上传 | ✅     | ✅             | ✅       | ✅       | ✅       |

统一降级规则：

- **不支持流式的渠道改为"先回执后补发"**：立刻回一条"正在处理"，完成后编辑或追发结果
- 超长文本按渠道上限分段，代码块与表格优先转为附件而非截断
- 不支持互动组件的渠道，审批一律降级为深链接回主应用
- 渲染失败必须降级为纯文本，不允许静默丢消息

### 7.7 速率、配额与成本

- 每个渠道 adapter 独立限流，遵守平台自身频控并实现指数退避
- 群聊默认**仅响应 @ 提及**，避免刷屏与成本失控
- 渠道来源的 Run 计入用户统一预算；超预算时在渠道内明确告知并停止，不静默失败
- 单用户、单群、单渠道三级配额独立可配

### 7.8 安全

- **入站必须验签**（飞书/企微/钉钉的签名校验、Telegram secret token、Slack signing secret、
  Discord Ed25519、QQ 官方签名），验签失败直接丢弃并计数告警
- 事件**必须幂等去重**：平台重试普遍存在，重复事件不得触发第二次 Run
- 渠道凭据一律存 Secret Store，不落库明文、不写日志
- 渠道输入是**不可信内容**：群消息、转发内容、附件文本都可能含提示注入，
  必须走与 Phase 6 相同的注入防护与工具审批边界，不因"来自 IM"而放宽
- 群聊中他人消息进入上下文前需遵守可见性策略，**不得把个人私密记忆带入群会话**
- 机器人不得在群内回显用户的私密记忆、连接器数据或审批详情

### 7.9 各渠道要点

- **QQ**：官方机器人开放平台需企业/开发者资质，私域与公域能力差异大；
  自托管场景走 OneBot v11/v12（NapCat/Lagrange 等实现），需说明其非官方性质与封号风险
- **飞书 / Lark**：事件订阅需回调地址验证；互动卡片是最适合做审批 UI 的渠道
- **企业微信 / 钉钉**：与飞书同构，注意各自的加解密与回调格式差异
- **Telegram**：需要出海网络；长轮询与 Webhook 二选一，Webhook 需公网 HTTPS
- **Discord**：交互需在 3 秒内响应，超时必须先 defer
- **Slack**：同样需 3 秒内 ack，复杂处理走异步

### 7.10 测试要求

- 每个 adapter 的**验签、去重、限流退避**必须有单元测试
- 归一化入站消息与渲染出站消息使用 **golden 契约文件**，防止跨渠道格式回归
- 绑定流程测试：未绑定私聊、配对码过期、重复绑定、解绑后拒绝
- 审批测试：渠道内审批生效、高风险强制回主应用、多渠道并发点击的原子性
- 安全测试：伪造签名、重放事件、群消息提示注入、私密记忆不泄漏到群聊

### 7.11 验收标准

- 至少一个渠道（W1）完成端到端：绑定 → 私聊提问 → Run → 回复 → 审批 → 解绑
- 伪造签名与重放事件被拒绝且有告警计数
- 群聊场景下个人私密记忆不出现在任何输出中，有测试证据
- 新增一个渠道无需修改核心服务，仅新增 adapter 实现与配置

---

## 8. 外部 Agent 协作

### 8.1 Capability Card

外部 Agent 发布：

- 稳定身份、运营者和 endpoint
- 能力与输入/输出 schema
- 所需数据、保留策略和地区
- 风险上限、是否继续委派、价格和 SLO
- 支持的协议版本和签名公钥

### 8.2 Delegation Envelope

只发送完成子任务所需的最小内容：

- task ID、目标、成功标准和 deadline
- 允许的数据引用或短期 capability token
- 输出 schema、预算和最大重试
- 禁止的动作和是否允许再委派（默认 false）
- trace context 和回调地址

不发送用户完整会话、全部记忆、长期 Secret 或无关联系人。

### 8.3 信任与验证

- 外部 Agent 输出视为不可信，进入 Reviewer 和安全扫描
- Artifact 校验 hash、MIME、大小和恶意软件
- 外部“已执行”声明必须有可验证回执；无法验证则标记 unknown
- 任何外部副作用继续由 yuanai Approval/Policy 控制
- 用户可以完全禁用外部 Agent

---

## 9. 自托管与可迁移性

### 9.1 部署形态

- yuanai Cloud：托管控制面和云端 Worker
- Self-hosted：Docker Compose/Kubernetes，用户自管 Provider 和存储
- Hybrid：Cloud 控制面 + 用户 Desktop/VPS Execution Node

### 9.2 导出包

用户可导出：

- 助理与空间配置
- Memories（含来源，不含无法导出的第三方 Secret）
- Knowledge Source 元数据和用户拥有的文件
- Skills、场景和自动化
- 会话、Run、Artifact 和审计摘要

格式使用版本化 JSON/JSONL + 文件清单 + hash。导入先 dry-run，展示冲突、缺失连接和不兼容扩展。

### 9.3 云端与社区版边界

具体开源许可证和商业边界需要单独决策并记录 ADR。推荐原则：

- 核心协议、SDK、manifest 和基础 Tool Runtime 保持开放
- 托管运维、商业连接器、企业治理和大规模执行可作为云服务价值
- 不通过封闭数据格式阻止迁移

---

## 10. 生态治理

- 发布者准入、身份验证和申诉
- 内容、版权、恶意用途和地区政策
- 扩展安全响应 SLA
- 高风险类别额外审核
- 社区维护者权限最小化
- 市场下架不删除用户本地合法副本，但可阻止连接平台服务
- 用户举报和自动检测均需人工复核高影响决定

---

## 11. 开发者体验

```text
yuanai extension init
yuanai extension dev
yuanai extension test
yuanai extension eval
yuanai extension permissions
yuanai extension pack
yuanai extension sign
yuanai extension publish --channel beta
```

本地 Dev Host 提供模拟用户、连接、审批、Run 和 Artifact；默认不允许连接生产用户数据。

文档必须包含：最小 Skill、OAuth Connector、MCP adapter、声明式 UI、评测和安全发布完整示例。

---

## 12. 测试要求

- Manifest canonicalization、签名、篡改和密钥轮换
- 新权限更新强制重新授权
- Connector/Plugin 容器无法访问宿主和其他扩展 Secret
- UI Extension XSS、CSP、钓鱼和消息伪造
- 恶意 Skill Prompt injection 与数据外传
- 渠道身份绑定、群聊隔离、重复消息和审批竞态
- 外部 Agent capability token 过期、重放和越权
- 导出/导入 round-trip、冲突和版本迁移
- 撤回 advisory 在 Cloud、Desktop 和自托管实例生效

---

## 13. 验收标准

- [ ] 第三方无需修改主仓库即可开发、测试和发布一个 Skill/Connector
- [ ] 安装前用户能看懂扩展将访问的数据、工具和外部服务
- [ ] 扩展更新新增权限时不会静默生效
- [ ] 高危扩展可按 hash 紧急撤回并停止相关自动化
- [ ] 同一用户可从至少三个渠道访问同一个助理和 Run 历史
- [ ] 群聊渠道不能访问个人私密空间和连接
- [ ] 外部 Agent 只获得最小委派上下文，结果经过验证
- [ ] 用户能把核心数据导出并在自托管实例完成 dry-run 导入
- [ ] SDK、协议、版本兼容和供应链安全测试通过

**长期产品门禁**：生态增长不能以降低权限透明度、数据主权和安全审核为代价；任何扩展都必须继续服从 yuanai 的 Run、Policy、Approval、Budget 和 Audit 控制面。
