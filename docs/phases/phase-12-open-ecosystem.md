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

## 7. 跨渠道 Gateway

### 7.1 渠道

- Email
- Telegram / Discord / Slack
- 飞书 / 企业微信等区域性平台
- Webhook / API client
- 语音入口和系统分享菜单

各渠道 adapter 只负责收发、身份映射、附件和平台交互；同一 Agent Runtime、Run、记忆和审批仍在核心服务。

### 7.2 身份绑定

- 用户必须在已登录 yuanai 客户端生成绑定流程
- 私信默认 pairing，不接受任意陌生用户控制助理
- 群聊按空间和频道配置，默认不能访问个人私密记忆/连接
- 渠道账号撤销后立即停止新消息，历史保留按用户策略

### 7.3 渠道能力降级

- 复杂计划和权限详情提供安全深链接回主应用
- 简单审批可在渠道内完成，但高风险动作要求主应用二次确认
- 渠道文本长度、附件和格式差异由 adapter 转换
- 多渠道同时操作同一审批使用原子决定，后续点击显示已处理

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
