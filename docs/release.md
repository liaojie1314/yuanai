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

### 第一次配置：GitHub 页面位置

所有值都在仓库级别配置。打开 GitHub 仓库后进入：

`Settings` → `Secrets and variables` → `Actions`

在 `Secrets` 页点击 `New repository secret` 添加敏感值，在 `Variables` 页点击
`New repository variable` 添加非敏感配置。名称必须与下表完全一致；值不要加引号、不要
把命令提示符或换行复制进去。Secret 创建后 GitHub 不会再次显示明文，只能删除后重新创建。

本项目的最小配置如下：

| 类型     | 名称                          | 是否必需                | 用途                     |
| -------- | ----------------------------- | ----------------------- | ------------------------ |
| Secret   | `EXPO_TOKEN`                  | Android release 必需    | EAS 云构建登录令牌       |
| Variable | `EXPO_PROJECT_ID`             | Android release 必需    | Expo/EAS 项目 UUID       |
| Secret   | `CSC_LINK`                    | Windows 签名可选        | 自签名 PFX 的单行 Base64 |
| Secret   | `CSC_KEY_PASSWORD`            | Windows 签名可选        | PFX 密码                 |
| Secret   | `APPLE_ID`                    | macOS notarization 可选 | Apple Developer 账号邮箱 |
| Secret   | `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarization 可选 | Apple ID 生成的专用密码  |
| Secret   | `APPLE_TEAM_ID`               | macOS notarization 可选 | Apple Developer Team ID  |

`GITHUB_TOKEN` 由 GitHub 自动注入，不要手工创建。当前 workflow 不读取 Android 本地
keystore，因此不要上传 `ANDROID_KEYSTORE_BASE64` 等自定义 Android 私钥 Secret。

### Android：获取 `EXPO_TOKEN` 和 `EXPO_PROJECT_ID`

1. 在 [Expo Access Tokens](https://expo.dev/accounts/%5Baccount%5D/settings/access-tokens)
   登录自己的 Expo 账号，点击 `Create token`，名称可填 `yuanai-github-actions`，复制
   只显示一次的 token。在 GitHub Actions Secrets 中创建 `EXPO_TOKEN`，粘贴这串 token。
2. 在本机仓库根目录执行：

   ```bash
   pnpm dlx eas-cli@12.0.0 login
   pnpm dlx eas-cli@12.0.0 init
   ```

   按提示选择自己的 Expo 账号和 `yuanai` 项目。命令输出的 `projectId` 是一个 UUID，
   也可以在 Expo 项目页面 `Project settings` → `General` → `Project ID` 复制它。

3. 在 GitHub Actions **Variables** 中创建 `EXPO_PROJECT_ID`，粘贴上一步的 UUID（不是
   `PROJECT_ID_PLACEHOLDER`，也不是 `https://u.expo.dev/...` 的完整 URL）。
4. 用下面命令确认当前项目读到的值：

   ```bash
   EXPO_PROJECT_ID=<复制的 UUID> pnpm dlx eas-cli@12.0.0 project:info
   ```

   Actions 运行前会主动检查这两个值；缺少任意一个会在 Android job 开始处明确失败。
   `EXPO_TOKEN` 只用于 CI 登录，不能替代 `EXPO_PROJECT_ID`。

> 安全提示：不要把 token 写入 `app.json`、`.env.example`、EAS 配置或终端截图。若 token
> 泄露，立即在 Expo 的 Access Tokens 页面撤销并重新创建。

### Windows：生成 `CSC_LINK` 和 `CSC_KEY_PASSWORD`

这两个 Secret 只在希望 GitHub Actions 给 Windows 安装包签名时需要。它们不是从 GitHub
获取的，而是由本项目脚本在本机生成：

```bash
pnpm signing:desktop:windows:test
```

脚本会在 `~/.yuanai-secrets/` 生成：

- `yuanai-windows-test.pfx`：证书和私钥，不能提交；
- `yuanai-windows-test.json`：其中的 `password` 是 `CSC_KEY_PASSWORD`。

在 Linux/macOS 终端生成 `CSC_LINK` 的值（输出是一整行，复制完整输出）：

```bash
base64 -w0 ~/.yuanai-secrets/yuanai-windows-test.pfx
```

macOS 没有 `-w` 参数时使用：

```bash
base64 < ~/.yuanai-secrets/yuanai-windows-test.pfx | tr -d '\\n'
```

在 GitHub Actions Secrets 中分别创建：

- `CSC_LINK`：上面命令输出的整行 Base64；
- `CSC_KEY_PASSWORD`：打开本机 JSON 文件，复制 `password` 字段的值，不要复制 JSON
  的引号或逗号。

自签名证书只适合本人电脑和内测，Windows 仍会显示“未知发布者”。不需要 Windows 签名
时可以不配置这两个 Secret，workflow 仍会构建未签名包。

### macOS：签名与 notarization（可选）

macOS 公证需要 Apple Developer 账号。创建 Developer ID Application 证书后，在钥匙串
中导出带密码的 `.p12`，将它按 Windows PFX 的方式转为 Base64，放入 `CSC_LINK`；导出
密码放入 `CSC_KEY_PASSWORD`。然后在 [Apple ID 账户](https://appleid.apple.com/) 的
`Sign-In and Security` → `App-Specific Passwords` 创建专用密码，填入
`APPLE_APP_SPECIFIC_PASSWORD`；Apple 账号邮箱填 `APPLE_ID`，Team ID 可在
[Apple Developer Membership](https://developer.apple.com/account) 页面复制到
`APPLE_TEAM_ID`。

没有这些值时 macOS job 仍可生成未签名安装包；不要用 Apple ID 主密码代替专用密码。

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
