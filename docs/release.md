# 发版与 CI/CD

本项目使用 `release-it` 管理版本、CHANGELOG 和 Git tag，使用 GitHub Actions 在
Linux、Windows、macOS runner 上构建 Web 与 Electron 安装包，并通过 EAS 构建 Android
`.aab`。iOS 原生包仍需 Apple runner 和 Apple 凭据，当前 workflow 不伪造 iOS 发布。

## 固定版本

项目统一使用：

| 工具      | 版本      | 来源                                              |
| --------- | --------- | ------------------------------------------------- |
| Node.js   | `22.21.1` | `.node-version`、`.nvmrc`、`package.json#engines` |
| pnpm      | `10.22.0` | `package.json#packageManager`                     |
| Turborepo | `2.10.7`  | 根 `devDependencies`                              |
| Python    | `3.12`    | `.python-version`                                 |
| uv        | `0.11.3`  | CI workflow                                       |

发布前请确认工作区干净、当前已经合并到本地 `master`，并运行：

```bash
pnpm check:runtime
pnpm install --frozen-lockfile
pnpm release:dry
```

`release:dry` 不会修改文件、创建 tag 或 push。正式 release-it 只能在 `master` 执行，
会同步所有 workspace 和 Expo 版本，更新 `CHANGELOG.md`，创建 `v<version>` tag 并 push。
本项目明确关闭 release-it 自己的 GitHub Release，由 tag 触发的 Actions 统一上传产物。

```bash
# 用户确认后才执行；命令会 push commit 与 tag
pnpm release:patch
pnpm release:minor
pnpm release:major
```

当前流程约束：feature 分支先完成测试并合并到本地 `dev`；本地打包验证通过后暂停，
等待维护者明确允许，再合并 `dev` 到 `master`、执行 release-it 和 push。没有确认时不要
创建 tag，也不要手工运行 GitHub Release workflow。

## 本地打包验证

所有构建必须经 package.json script：

```bash
pnpm build
pnpm package:desktop:linux
pnpm package:mobile:android
```

Linux 本地可以验证 Electron 安装包和 Android release APK；Windows 和 macOS 的签名、
notarization 及安装验收由对应 GitHub runner 执行。Android 本地构建要求设置
`ANDROID_HOME`/`ANDROID_SDK_ROOT`、安装 Android SDK 和 JDK 17。首次本地 release 打包前，
还必须运行 `pnpm signing:android`；脚本会将自签名 keystore 保留在
`~/.yuanai-secrets/`，并在构建时只通过 Gradle 进程参数传入，绝不写进原生目录或仓库。
交互式入口 `pnpm package:desktop` 会按当前系统只显示可用目标。

## GitHub Actions

`.github/workflows/ci.yml` 在 `dev`/`master` 的 push 和 PR 上执行：

- 固定 Node/pnpm，`pnpm install --frozen-lockfile`；
- format、lint、typecheck、前端单元测试和 Web Playwright smoke test；
- PostgreSQL `16.14-alpine`、Redis `7.4.9-alpine` 服务上的 Ruff、mypy、后端单元/集成测试。

`.github/workflows/release.yml` 只在 `v*` tag 或手动补跑时执行。Web、Electron 和 Android
先分别上传 artifact，最后由拥有 `contents: write` 权限的 `publish` job 创建 GitHub Release。
Electron 构建调用 `pnpm package:desktop:linux|win|mac`，Android 构建调用
`pnpm --filter @yuanai/mobile build:android:production`，不会把 `GH_TOKEN` 传给构建命令，
因此构建阶段不会提前发布或覆盖 Release。

手动补跑时，在 Actions 页面选择 Release，填写已有 tag；`ref` 可指定构建分支或 commit，
`only` 可在单个平台失败后只重建 `web`、`desktop` 或 `mobile`。`only` 不是正式发版授权，正式 tag 仍
需先经过本地验证和维护者确认。

## Secrets 与证书

普通 CI 和未签名构建不需要手工生成 token。GitHub Actions 自动提供的
`GITHUB_TOKEN` 只在 `publish` job 使用，不需要添加到仓库 Secrets。不要把 API key、私钥或
个人访问 token 写进仓库、workflow、`.env.example` 或日志。

### Electron Windows 自签名（个人项目可选）

个人项目可以使用仓库脚本生成自签名 `.pfx`，但 Windows 不会默认信任它，其他用户会看到
“未知发布者”提示。它适合个人设备、内测和 GitHub Actions 打包验证；公开分发仍应换成受信任
的代码签名证书。先在本机生成：

```bash
pnpm signing:desktop:windows:test
```

脚本只在 `~/.yuanai-secrets/yuanai-windows-test.pfx` 和同目录 JSON 中保存私钥、密码。
把证书转成单行 Base64 后，在仓库 `Settings → Secrets and variables → Actions` 添加：

```bash
# GNU/Linux
base64 -w0 signing.pfx
# macOS
base64 < signing.pfx | tr -d '\n'
```

| Secret             | 内容                                                  |
| ------------------ | ----------------------------------------------------- |
| `CSC_LINK`         | `.pfx` 的 Base64 内容（electron-builder 支持 Base64） |
| `CSC_KEY_PASSWORD` | PFX 导出密码                                          |

```bash
base64 -w0 ~/.yuanai-secrets/yuanai-windows-test.pfx
```

`CSC_LINK` 和 `CSC_KEY_PASSWORD` 只会注入 Windows release job；不会把 Windows 证书传给
macOS job。不要把 `yuanai-windows-test.pfx`、JSON 或密码提交到仓库。

### Electron macOS 签名与 notarization（可选）

从 Apple Developer 申请 Developer ID Application 证书，在钥匙串中导出 `.p12`，然后用
上面的 Base64 方法生成 `CSC_LINK`。再创建 App-specific password（Apple ID → Sign-In and
Security → App-Specific Passwords），添加：

| Secret                        | 内容                                      |
| ----------------------------- | ----------------------------------------- |
| `CSC_LINK`                    | Developer ID `.p12` 的 Base64 内容        |
| `CSC_KEY_PASSWORD`            | `.p12` 导出密码                           |
| `APPLE_ID`                    | Apple Developer 账号邮箱                  |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password，不是 Apple ID 密码 |
| `APPLE_TEAM_ID`               | Apple Developer Team ID                   |

没有这些 Secrets 时 workflow 仍会生成未签名安装包，便于先验证跨平台构建；不能把未签名包
宣称为可公开分发版本。

个人项目不需要为了 macOS 强行添加这些 Secrets；当前 Linux 本地和 GitHub Actions 均可先生成
未签名 macOS 包，之后再决定是否购买 Apple Developer 签名与 notarization。

### Mobile Android/EAS

Android 使用 EAS 云构建和 EAS 托管的 Android 签名凭据，不需要把本地 keystore 上传到
GitHub。首次使用前需要在本机登录并创建/关联 EAS 项目：

```bash
pnpm dlx eas-cli@12.0.0 login
pnpm dlx eas-cli@12.0.0 init
```

把 EAS 项目的 ID 添加为 GitHub **Variable** `EXPO_PROJECT_ID`，把访问令牌添加为 GitHub
**Secret** `EXPO_TOKEN`。`apps/mobile/app.config.js` 会在 CI 中注入 project ID，本地
Expo Go 仍可使用 `app.json` 的占位值。workflow 会上传 EAS 返回的 Android `.aab` 到
GitHub Release。

`api.yuanai.example.com` 和 `api-staging.yuanai.example.com` 是仓库示例地址，不是可公开
发布的后端。首次 EAS 公开构建前，必须在 EAS 对应环境配置真实 HTTPS
`EXPO_PUBLIC_API_URL`，并替换 `apps/mobile/eas.json` 的示例值。真机本地测试可通过 USB
执行 `adb reverse tcp:8000 tcp:8000`，让开发包中的 `localhost:8000` 指向电脑后端；这不适用
于非 USB 或公开发布的安装包。

如果你不使用 EAS 托管凭据，仍可在本机生成独立 keystore，材料只保存在用户目录：

```bash
pnpm signing:android
```

自定义 keystore 暂未接入当前 EAS workflow；不要把 `~/.yuanai-secrets` 下的文件提交或
上传到普通仓库文件中。

## 故障排查

- `release:dry` 报分支错误：这是预期的保护；dry run 已显式关闭分支检查，正式 release 必须
  在 `master`。
- `pnpm install --frozen-lockfile` 失败：确认 Node `22.21.1`、pnpm `10.22.0`，不要使用
  pnpm 11 重新生成锁文件。
- Linux 打包失败：先运行 `pnpm --filter @yuanai/desktop build`，再运行
  `pnpm package:desktop:linux`；不要绕过根 script 直接调用 electron-builder。
- Windows/macOS 证书失败：检查 Base64 是否为单行、密码是否匹配，并确认 workflow Secret
  没有被设置为带引号的字符串。
