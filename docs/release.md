# 发版与 CI/CD

本项目使用 `release-it` 管理版本、CHANGELOG 和 Git tag。GitHub Actions 在 Linux、Windows、
macOS runner 上构建并直接上传 Web 与 Electron 安装包；Android 由本机 Gradle 构建、签名并
上传到同一 GitHub Release，避免 EAS 免费队列和云端固定运行时与项目工具链不一致的问题。iOS
原生包仍需 Apple runner 和 Apple 凭据，当前 workflow 不伪造 iOS 发布。

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

首次发布已经预同步版本号时，使用 `pnpm run release --ci 0.1.0`；release-it 已配置允许
`npm version` 保持同版本，并使用符合 commitlint 的 `chore(config):` release commit。

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

`.github/workflows/ci.yml` 在 `dev` push 和指向 `dev`/`master` 的 PR 上执行；直接 push 到
`master` 不再重复运行同一套 CI，发布前必须通过 `dev` 到 `master` 的 PR 门禁：

- 固定 Node/pnpm，`pnpm install --frozen-lockfile`；
- format、lint、typecheck、前端单元测试和 Web Playwright smoke test；
- PostgreSQL `16.14-alpine`、Redis `7.4.9-alpine` 服务上的 Ruff、mypy、后端单元/集成测试。

`.github/workflows/release.yml` 只在 `v*` tag 或手动补跑时执行。Release 描述取目标版本的
`CHANGELOG.md` 小节：`prepare` job 会定位当前版本标题，去掉标题行后创建或更新 GitHub Release。
Web 和每一个 Electron 矩阵 job 在自身构建成功后直接向该 Release 上传产物；重跑会
使用 `gh release upload --clobber` 替换同名文件，因此单独补跑 `web` 或 `desktop` 有实际作用。
这样上传步骤不会再次调用第三方 action 的 Release 更新接口，也不会受手动触发时
`github.ref=refs/heads/<branch>` 的影响。Electron 构建仍只调用
`pnpm --filter @yuanai/desktop package:linux|win|mac`，package script 内置 `--publish never`，
不会让 Electron Builder 自行发布。

桌面端自动更新使用 `electron-updater` 的 GitHub provider，不使用 Tauri/minisign 的 `.sig`
文件。Windows Release 必须同时上传 NSIS 安装包、`*.exe.blockmap` 和 `latest.yml`；macOS
必须上传 ZIP、`*.zip.blockmap` 和 `latest-mac.yml`；Linux AppImage 更新必须上传
AppImage 和 `latest-linux.yml`（Linux 的 block map 大小写在 YAML 元数据中，不是独立文件）。这些 YAML 文件是客户端定位版本和下载地址的
更新源元数据；Windows 的 Authenticode 签名嵌入 `.exe`，不会生成独立 `.sig`。

Android 不再在 GitHub Actions 或 EAS 云端构建。使用本机 `pnpm package:mobile:android` 生成、
验证 APK 后，再以 `pnpm release:upload:android -- v<version>` 上传到已有 Release。

手动补跑时，在 Actions 页面选择 Release，填写已有 tag；`ref` 可指定构建分支或 commit，
`only` 可在失败后只重建 `web` 或 `desktop`；Android 为本地上传，不属于此 workflow。`only`
不是正式发版授权，正式 tag 仍需先经过本地验证和维护者确认。

### v0.1.0 产物矩阵

| 端              | Runner/方式         | 产物                                         |
| --------------- | ------------------- | -------------------------------------------- |
| Web             | GitHub Ubuntu       | `yuanai-web-v0.1.0.tar.gz`                   |
| Desktop Windows | GitHub Windows 2022 | NSIS setup、portable、`latest.yml`、blockmap |
| Desktop macOS   | GitHub macOS 14     | DMG、ZIP、`latest-mac.yml`、blockmap         |
| Desktop Linux   | GitHub Ubuntu 22.04 | AppImage、deb、rpm、`latest-linux.yml`       |
| Mobile Android  | 本机 Gradle + `gh`  | `YuanAI-v0.1.0-android.apk`                  |

当前 Release workflow 不构建 iOS；iOS 需要 Apple runner、证书和签名配置，后续单独接入。
Electron 构建产物由 `electron-builder` 写入 `apps/desktop/dist/`，workflow 会从该目录上传。

## Secrets 与证书

普通 CI 和未签名构建不需要手工生成 token。GitHub Actions 自动提供的
`GITHUB_TOKEN` 由 Actions 自动注入到 `prepare`、Web 和桌面上传步骤，不需要添加到仓库
Secrets。本地 Android 上传使用已认证的 GitHub CLI。不要把 API key、私钥或个人访问 token
写进仓库、workflow、`.env.example` 或日志。

### 第一次配置：GitHub 页面位置

所有值都在仓库级别配置。打开 GitHub 仓库后进入：

`Settings` → `Secrets and variables` → `Actions`

在 `Secrets` 页点击 `New repository secret` 添加敏感值，在 `Variables` 页点击
`New repository variable` 添加非敏感配置。名称必须与下表完全一致；值不要加引号、不要
把命令提示符或换行复制进去。Secret 创建后 GitHub 不会再次显示明文，只能删除后重新创建。

本项目的最小配置如下：

| 类型   | 名称                          | 是否必需                | 用途                     |
| ------ | ----------------------------- | ----------------------- | ------------------------ |
| Secret | `CSC_LINK`                    | Windows 签名可选        | 自签名 PFX 的单行 Base64 |
| Secret | `CSC_KEY_PASSWORD`            | Windows 签名可选        | PFX 密码                 |
| Secret | `APPLE_ID`                    | 后续 macOS notarization | Apple Developer 账号邮箱 |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | 后续 macOS notarization | Apple ID 生成的专用密码  |
| Secret | `APPLE_TEAM_ID`               | 后续 macOS notarization | Apple Developer Team ID  |

`GITHUB_TOKEN` 不需要手工创建。旧的 `EXPO_TOKEN`、`EXPO_PROJECT_ID` 及四个
`ANDROID_KEYSTORE_*` GitHub Secrets 不再被 Release workflow 读取，可在确认没有其他
workflow 使用后从仓库 Secrets 删除；本地 Android 私钥仍只保留在 `~/.yuanai-secrets/`。

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

### macOS：签名与 notarization（后续接入）

当前 Release workflow 的 macOS job 只生成未签名 DMG/ZIP，并且不会注入 `CSC_LINK`、
`CSC_KEY_PASSWORD` 或 `APPLE_*` 环境变量。这样可以避免把 Windows 自签名 PFX 或空的
签名变量错误传给 macOS。不要将当前的 Windows `CSC_LINK` Secret 复用于 macOS。

后续接入 macOS 签名时，需要 Apple Developer 账号和独立的 Developer ID Application
证书；在钥匙串中导出带密码的 `.p12`，并按 workflow 新增的 macOS 专用证书 Secret 配置。
公证还需要在 [Apple ID 账户](https://appleid.apple.com/) 的 `Sign-In and Security` →
`App-Specific Passwords` 创建专用密码，账号邮箱填 `APPLE_ID`，Team ID 可在
[Apple Developer Membership](https://developer.apple.com/account) 页面复制到
`APPLE_TEAM_ID`。

不要用 Apple ID 主密码代替专用密码；在 macOS 专用证书 workflow 接入前，以上 Apple
凭据不会影响当前发版构建。

### Mobile Android：本地构建与上传

Android release 不经过 EAS 云构建。先在本机生成一次自签名 keystore：

```bash
pnpm signing:android
```

签名材料保存在 `~/.yuanai-secrets/`，不会写进仓库。设置 Android SDK、JDK 17 后构建：

```bash
pnpm package:mobile:android
```

该脚本通过 Expo prebuild 和 Gradle wrapper 创建签名 APK：
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`。先在真机安装验证，再
上传到已由 Release workflow 创建的 GitHub Release：

```bash
gh auth status
pnpm release:upload:android -- v0.1.0
```

`gh` 必须已登录具有私有仓库写权限的账号；`repo` scope 足够上传 Release 资产，`workflow`
scope 只用于从本机读取或触发 GitHub Actions。上传脚本会以
`YuanAI-v0.1.0-android.apk` 命名资产，并在重复上传时替换同名 APK。不要把
`~/.yuanai-secrets` 下的私钥、旧 GitHub Secret 导出文本或 APK 提交到仓库。

`api.yuanai.example.com` 和 `api-staging.yuanai.example.com` 是仓库示例地址，不是可公开
发布的后端。公开 Android 包之前，必须在实际应用配置中使用真实 HTTPS
`EXPO_PUBLIC_API_URL`。真机本地测试可通过 USB 执行 `adb reverse tcp:8000 tcp:8000`，让
开发包中的 `localhost:8000` 指向电脑后端；这不适用于非 USB 或公开发布的安装包。

## 故障排查

- `release:dry` 报分支错误：这是预期的保护；dry run 已显式关闭分支检查，正式 release 必须
  在 `master`。
- `pnpm install --frozen-lockfile` 失败：确认 Node `22.21.1`、pnpm `10.22.0`，不要使用
  pnpm 11 重新生成锁文件。
- Linux 打包失败：先运行 `pnpm --filter @yuanai/desktop build`，再运行
  `pnpm package:desktop:linux`；不要绕过根 script 直接调用 electron-builder。桌面 package
  script 已内置 `--publish never`，构建完成后由对应矩阵 job 上传到已准备的 GitHub Release。
- Windows/macOS 证书失败：检查 Base64 是否为单行、密码是否匹配，并确认 workflow Secret
  没有被设置为带引号的字符串。
- Android 本地构建提示找不到 SDK 或 JDK：设置 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 与
  `JAVA_HOME` 后重试；不要改用 EAS Actions 绕过本机工具链。
- Android 上传提示 `gh: command not found`：安装 GitHub CLI 并执行 `gh auth login`；提示
  认证失败时执行 `gh auth refresh --hostname github.com --scopes repo` 后重试。
