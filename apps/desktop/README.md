# 元AI桌面端

`@yuanai/desktop` 是元AI的 Electron 33 桌面客户端。它复用
`@yuanai/core` 的认证、API、SSE 和查询逻辑，在 Electron 主进程中提供安全
存储、窗口、托盘、文件选择、通知和全局快捷键能力。

## 已交付能力

- 主聊天、登录、注册、忘记密码、设置、关于、Artifact 与 OAuth 六类 renderer
  入口；注册和忘记密码使用独立窗口。
- 邮箱认证与 GitHub/Google OAuth；会话凭据经 Electron `safeStorage` 加密保存。
- 真实后端会话、模型、流式聊天、临时对话、会话管理、分享、文件/截图附件和
  消息操作。
- 可配置联网搜索：搜索与思考开关可独立使用；来源保存在消息工具记录中，在思考块的
  `search_web` 详情内安全打开。虚拟列表滚动不会重置已展开的思考或工具详情。
- Markdown、数学公式、代码高亮、数据预览与单一 Artifact 窗口；长聊天采用
  虚拟列表，滚动期间延迟 Prism 高亮以保持交互流畅。
- 明暗主题、语言、字体、密度、时间格式等服务端偏好同步；关闭到托盘、开机自启、
  可录入的全局快捷键和 AI 回复原生通知保存在本机。

## 启动真实 API

桌面端默认请求 `http://localhost:8000/api/v1`。先在仓库根目录启动 Docker
基础设施和 FastAPI，再运行下面的脚本。

```bash
# macOS / Linux
YUANAI_API_URL=http://localhost:8000/api/v1 pnpm --filter @yuanai/desktop dev

# Windows PowerShell
$env:YUANAI_API_URL = 'http://localhost:8000/api/v1'
pnpm --filter @yuanai/desktop dev
```

可选环境变量：

| 变量                   | 默认值                         | 用途                               |
| ---------------------- | ------------------------------ | ---------------------------------- |
| `YUANAI_API_URL`       | `http://localhost:8000/api/v1` | FastAPI `/api/v1` 基地址           |
| `YUANAI_WEB_URL`       | `http://localhost:3000`        | 分享链接等 Web 链接基地址          |
| `YUANAI_ASSET_ORIGINS` | 本地 MinIO 地址                | 额外静态资源域名，多个值用逗号分隔 |

非回环地址必须使用 HTTPS；运行时配置会拒绝带凭据、查询串或片段的 URL。

## 常用命令

所有命令均从仓库根目录运行，且只使用 `package.json` 中定义的脚本：

```bash
pnpm --filter @yuanai/desktop dev
pnpm --filter @yuanai/desktop build
pnpm --filter @yuanai/desktop preview
pnpm --filter @yuanai/desktop lint
pnpm --filter @yuanai/desktop typecheck
pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/desktop test:integration
pnpm --filter @yuanai/desktop test:e2e
```

`preview` 会通过 `scripts/desktop-preview.mjs` 启动已构建 renderer，并清除
宿主环境注入的开发服务器地址，适合验证生产资源加载。

## 打包与发布

```bash
pnpm --filter @yuanai/desktop build:unpack
pnpm --filter @yuanai/desktop package:linux
pnpm --filter @yuanai/desktop package:win
pnpm --filter @yuanai/desktop package:mac
pnpm --filter @yuanai/desktop package:all
```

这些命令调用 electron-builder；实际安装包格式由当前平台和 electron-builder
配置决定。Windows 会分别生成 NSIS setup 和 portable 两个文件，NSIS 更新源还会生成
`latest.yml` 与 `.exe.blockmap`；macOS 生成 `latest-mac.yml`，Linux AppImage 生成
`latest-linux.yml`。发布前必须完成以下外部验收：

- Windows、macOS 和 Ubuntu 分别运行对应的 `package:*` 脚本并安装，验证认证、真实
  聊天、系统托盘、全局快捷键、深链接和 Artifact 预览。
- 配置 Windows 代码签名、macOS notarization 与 GitHub Releases 更新源；用已发布的
  旧版本验证下载、重启安装和失败回退。Windows 不生成 Tauri 风格的独立 `.sig`，签名
  嵌入 `.exe`。
- 验证 Linux 桌面协议注册和更新提示；AppImage、deb、rpm 的安装路径均需覆盖。

版本发布由根目录 `release-it` 和 GitHub Actions 负责，签名证书、notarization、Secrets
生成和本地到 CI 的完整流程见 [发版与 CI/CD](../../docs/release.md)。

## 安全边界

- renderer 不启用 Node integration，IPC 只通过受信任的 preload bridge 调用。
- 自定义 `yuanai-app://` 和一次性 `yuanai-file://` 协议避免向 renderer 暴露本机
  路径；外链通过白名单由主进程打开。
- OAuth 自定义协议只传递短时一次性 code，由桌面端与后端交换会话，长期 token
  不进入 URI 或命令行。
- Linux 未提供可用系统钥匙串时不持久化登录凭据。

## 当前验收状态

Ubuntu 开发环境已完成真实后端聊天与认证联调、托盘人工验证，以及单元、集成、
类型检查、lint、构建和生产预览验证。v0.1.0 已通过 GitHub Actions 生成 Web、Linux、
Windows、macOS 产物，Android APK 由本机 Gradle 构建并上传；Windows/macOS 代码签名和
三平台安装验收仍需对应系统执行，详见
[Phase 4 文档](../../docs/phases/phase-4-desktop.md)。
