# 三方登录（OAuth）配置指南

> 位置：`docs-internal/oauth-setup.md`（不受 `docs/` 只读约束）。本文档只面向开发者，请勿把 Client Secret 提交到代码库。

当前落地：**GitHub**（推荐首个接入，无商务审核、流程最简）。
计划中：Google（免费 GCP 项目 + OAuth Client，测试模式免审核）、微信开放平台（需企业主体认证，二期落地）。
登录页 UI 保留三个入口（GitHub / Google / 微信），未落地的按 disabled + tooltip 「第三方登录即将开放」占位。Apple Sign-In 依赖 $99/年 Apple Developer 会员，已从占位列表移除。

---

## 一、GitHub OAuth App 申请

1. 打开 <https://github.com/settings/developers> → 「OAuth Apps」→ **New OAuth App**。
2. 填写：
   - **Application name**：`元AI (本地开发)` — 用户在授权页会看到，可含中文
   - **Homepage URL**：`http://localhost:3000`
   - **Application description**：（可选）`元AI 多端 AI 聊天应用，接入 GitHub 单点登录`
   - **Authorization callback URL**：**必须精确匹配** `http://localhost:8000/api/v1/auth/github/callback`
     - 生产环境需要另建一个 OAuth App（GitHub 每个 App 仅支持一个精确 callback）
3. 提交后拿到 **Client ID**；点击 **Generate a new client secret** 生成 **Client Secret**（只显示一次，遗失需重新生成）。

> 若要在生产环境启用，请再新建一个 OAuth App，把 Homepage / Callback URL 换成生产域名（例如 `https://yuanai.example.com` / `https://api.yuanai.example.com/api/v1/auth/github/callback`）。

---

## 二、后端环境变量

编辑 `backend/.env`（复制自 `.env.example`），追加：

```dotenv
# 三方登录 - GitHub
GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
GITHUB_CLIENT_SECRET=github_pat_XXXXXXXXXXXXXXXXXXXX
# 回调 URL - 必须与 GitHub OAuth App 中「Authorization callback URL」完全一致
GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/github/callback
# 前端地址 - 后端 exchange 完 code 后 302 跳到这里的 /oauth/callback
WEB_APP_URL=http://localhost:3000
```

> Client Secret 一旦意外提交，请立即在 GitHub OAuth App 页面点 **Revoke** 并重新生成。

---

## 三、执行数据库迁移

本次接入引入了 `users.github_id` 列和 `hashed_password` 可空调整（OAuth-only 用户没有本地密码）：

```bash
cd backend
uv run alembic upgrade head
```

对应 revision：`f9a3b7c214e5_add_github_oauth_to_user`。

---

## 四、前端环境变量

无需额外前端环境变量。前端只依赖已有的 `NEXT_PUBLIC_API_URL`（默认 `http://localhost:8000/api/v1`）。GitHub 登录按钮点击时会跳 `${NEXT_PUBLIC_API_URL}/auth/github`，其余流程由后端处理。

若前端部署在自定义域名，请同步更新后端 `WEB_APP_URL`，否则 OAuth 完成后无法正确跳回。

---

## 五、验证链路

启动后端 + 前端后：

1. 浏览器打开 <http://localhost:3000/login>
2. 点击「GitHub 登录」按钮
3. 观察到浏览器跳到 `github.com/login/oauth/authorize?...` — 允许授权
4. 授权后自动跳回 `http://localhost:3000/oauth/callback?access_token=...&refresh_token=...`
5. 页面显示「正在完成登录…」loading，随后跳到 `/chat`，右上角显示 GitHub 头像和用户名

### 常见失败排查

| 现象                                              | 原因                                                             | 处理                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GitHub 授权后 `redirect_uri is not associated...` | Callback URL 与 OAuth App 配置不完全一致（哪怕差个尾斜杠都不行） | 到 GitHub 页面重新校对，或调整 `GITHUB_REDIRECT_URI`                                                                          |
| 前端 callback 页 toast `OAUTH_STATE_INVALID`      | state 已过期（>5 分钟）或已被消费                                | 让用户重新点登录按钮；后台 Redis 可用性要保证                                                                                 |
| toast `OAUTH_EMAIL_UNAVAILABLE`                   | GitHub 账号未公开 primary email                                  | 让用户在 <https://github.com/settings/emails> 里勾选 "Keep my email addresses private" 关掉，或至少设一个可读的 primary email |
| 后端 503 `OAUTH_NOT_CONFIGURED`                   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 没配                 | 补 `.env` 并重启后端                                                                                                          |

---

## 六、账号关联逻辑

当同一浏览器上没有登录状态时点 GitHub 登录：

1. 后端拿到 `github_id` 后先按 `users.github_id` 查找
   - 命中 → 直接登录
2. 没找到再按邮箱 `users.email` 查找
   - 命中 → **自动关联**：写入 `github_id`，头像若空则用 GitHub 头像补齐
3. 都没有 → 新建账号：
   - `email` = GitHub primary email
   - `username` = GitHub `login`（冲突则加数字后缀，兜底随机 hex）
   - `hashed_password` = **NULL**（OAuth-only 用户没有本地密码）

⚠ 纯 GitHub 注册的账号想要用邮箱 + 密码登录，需要先通过「忘记密码」流程走一次 `/reset-password`（用邮箱验证码补设一个本地密码）。这里我们复用现有的验证码链路，无需为 OAuth 用户单开路径。

---

## 七、扩展到其他 provider

新增 provider（例如 Google）时：

1. `backend/app/core/config.py` 追加 `google_client_id / google_client_secret / google_redirect_uri`
2. `backend/app/services/oauth_service.py` 内新增：
   - `build_google_authorize_url()` — 拼 authorize URL + 写 state
   - `_exchange_code_for_google_token(code)` — POST `oauth2.googleapis.com/token`
   - `_fetch_google_profile(access_token)` — GET `openidconnect.googleapis.com/v1/userinfo`
   - `complete_google_callback(code, state, db)` — 复用 `_link_or_create_user`（把 `github_id` 抽象成 `provider_id + provider_name` 或再加一列 `google_id`）
3. `backend/app/api/v1/auth.py` 新增 `/google` 和 `/google/callback` 两个端点
4. 数据库迁移新增 `users.google_id` 列
5. 前端登录页把 Google 按钮的 `disabled` 去掉，onClick 改为跳 `${API_BASE_URL}/auth/google`

Apple 有额外要求：签名密钥 (JWT client_secret)、私有邮箱转发。参考 <https://developer.apple.com/documentation/sign_in_with_apple>。
