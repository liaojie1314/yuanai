# Android 原生 Google Sign-In 配置指南

本文讲**怎么在 Google Cloud Console 建 Android OAuth 客户端**，以及移动端原生
Google 登录（`POST /api/v1/auth/google/native`）需要配哪些变量。

Web 端的 Google OAuth（浏览器跳转 code 流）配置见
[三方登录（OAuth）配置指南 §7](oauth-setup.md)，本文只补原生 SDK 这条路径。

> ⚠ **本仓尚未做真机联调**：原生登录需要一个真实的 Android OAuth 客户端
> （包名 + SHA-1 指纹），当前仓库没有申请过，也没有在模拟器/真机上跑通过
> 完整链路。现有证据只覆盖后端集成测试与移动端单元测试（见文末「当前验证范围」）。
> iOS 侧结论**全部未实测**（本机没有 macOS/iOS 设备）。

---

## 一、是否收费

**不收费。** Google OAuth 2.0 / Google Sign-In 本身免费，创建 OAuth 客户端、
配置同意屏幕、登录调用都没有费用，也不需要绑定信用卡。

要注意的两件事：

| 事项           | 说明                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| OAuth 同意屏幕 | Testing（测试）模式免审核，但只有加进「测试用户」列表的账号能登录，上限 100 个                                 |
| 发布到正式状态 | 只用 `openid` / `email` / `profile` 这些非敏感 scope 时，发布也**不需要**付费审核；敏感 scope 才会触发人工审核 |

另外：原生 Google Sign-In 需要 Development Build（`expo run:android` / EAS Build），
**Expo Go 不支持**；EAS 云构建有免费额度上限，本地 Gradle 构建不花钱。

---

## 二、本仓的 Android 包名在哪看

包名写在 `apps/mobile/app.json` 的 `expo.android.package`：

```bash
# 在仓库根执行
node -e "console.log(require('./apps/mobile/app.json').expo.android.package)"
```

当前值是 `com.yuanai.app`。`app.config.js` 只覆盖 `extra.eas.projectId`，不会改包名，
所以这个值就是 Google Cloud Console 里要填的包名。

---

## 三、取 SHA-1 证书指纹

Android OAuth 客户端用「包名 + 签名证书 SHA-1」来认客户端，**debug 和 release
是两套不同的签名证书，SHA-1 不同**，要分别登记（可以在同一个 Android OAuth
客户端下填多个指纹，也可以建两个客户端）。

### 3.1 debug 证书（本地 `expo run:android` 用）

Expo prebuild 生成的 Android 工程用 Android SDK 默认的 debug keystore：

```bash
# 方式 A：gradle（推荐，不用自己找 keystore 路径）
cd apps/mobile/android && ./gradlew signingReport
# 在输出里找 Variant: debug → SHA1

# 方式 B：keytool 直接读默认 debug keystore
keytool -list -v -alias androiddebugkey \
  -keystore "$HOME/.android/debug.keystore" \
  -storepass android -keypass android | grep SHA1
```

> `apps/mobile/android/` 由 `pnpm --filter @yuanai/mobile prebuild` 生成；
> 如果目录不存在，先跑一次 prebuild 再执行 `./gradlew signingReport`。

### 3.2 release 证书

取决于用哪种签名：

| 签名方式                       | 怎么取 SHA-1                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 自己的 release keystore        | `keytool -list -v -alias <你的 alias> -keystore <你的 keystore 路径> \| grep SHA1`                           |
| EAS 托管签名                   | `pnpm dlx eas-cli credentials` → 选 Android → 查看 Keystore，界面里会显示 SHA-1                              |
| Google Play 应用签名（上架后） | Play Console → 发布 → 设置 → 应用签名 → 「应用签名密钥证书」的 SHA-1，**这个也必须登记**，否则线上包登录失败 |

**不要把 keystore 文件或其口令提交到仓库。**

---

## 四、创建 Android OAuth 客户端

1. 打开 <https://console.cloud.google.com/> → 选中与 Web 端同一个项目
   （同项目才能让 Web / Android 客户端共用一套同意屏幕和用户身份）。
2. 「API 和服务 → OAuth 同意屏幕」：确认已配置（Web 端那一步已经做过）。
   Testing 模式下把测试用的 Google 账号加进「测试用户」。
3. 「API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID」：
   - **应用类型**：`Android`
   - **名称**：随便填，例如 `元AI Android (debug)`
   - **软件包名称**：`com.yuanai.app`（第二节取到的值）
   - **SHA-1 证书指纹**：第三节取到的指纹，形如
     `AA:BB:CC:DD:...`（大写十六进制，冒号分隔）
4. 创建后得到 **Android client id**，形如
   `<your-android-client-id>.apps.googleusercontent.com`。
   Android 客户端**没有 client secret**，这是正常的。
5. 如果还要支持 iOS：另建一个「iOS」类型客户端，填 Bundle ID
   `com.yuanai.app`，得到 `<your-ios-client-id>`。**本仓未实测 iOS。**

---

## 五、Web client id 和 Android client id 的关系，`aud` 配哪个

这是原生登录最容易配错的地方。

原生 SDK 返回的 id_token，它的 `aud`（受众）**取决于客户端初始化方式**：

| 移动端配置                                | id_token 的 `aud`       |
| ----------------------------------------- | ----------------------- |
| `GoogleSignin.configure({ webClientId })` | **Web** client id       |
| 没传 `webClientId`（仅靠平台客户端配置）  | Android / iOS client id |

本仓移动端 `apps/mobile/src/lib/googleSignIn.ts` **总是传 `webClientId`**
（Android 上它就是 `serverClientId`），所以正常路径下 `aud` 是 **Web client id**。

但后端不能只认一个值——换个配置方式就会收到平台 client id——所以
`backend/app/services/oauth_service.py` 的 `_google_native_audiences()` 维护一个
**允许集合**：

- `GOOGLE_CLIENT_ID`（Web client id）始终自动在集合里；
- `GOOGLE_NATIVE_CLIENT_IDS` 里逗号分隔追加 Android / iOS client id。

**结论**：Android client id 仍然必须创建（Google 要靠包名+SHA-1 认客户端，
否则原生 SDK 直接报 `DEVELOPER_ERROR`），但传给 SDK 的是 **Web client id**；
后端把两者都列进允许的 audience 最稳。

> `aud` 校验不是形式主义：如果放过任意 `aud`，攻击者可以拿**别的应用**签发给他
> 自己的合法 Google id_token 来登录本站的任意账号。后端对签名、`iss`、`exp`、
> `aud` 全部强校验，任一不满足就返回 4xx（见 `verify_google_id_token`）。

---

## 六、要配的环境变量

### 6.1 后端 `backend/.env`

```dotenv
# Web 端那份（已有，原生登录复用它作为允许的 aud 之一）
GOOGLE_CLIENT_ID=<your-web-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-web-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback

# 原生登录新增：额外允许的 id_token aud，逗号分隔。
# 只在移动端不传 webClientId、或要同时兼容 iOS 时才需要填。
GOOGLE_NATIVE_CLIENT_IDS=<your-android-client-id>.apps.googleusercontent.com,<your-ios-client-id>.apps.googleusercontent.com
```

`GOOGLE_NATIVE_CLIENT_IDS` 与 `GOOGLE_CLIENT_ID` 同时为空时，
`POST /auth/google/native` 返回 **503 `OAUTH_NOT_CONFIGURED`**。

原生登录**不需要** `GOOGLE_CLIENT_SECRET`（不做 code 交换），但 Web 流程需要，
所以照常保留。

### 6.2 移动端 `apps/mobile/.env`（从 `.env.example` 复制）

```dotenv
# Web client id —— Android 上同时作为 serverClientId，决定 id_token 的 aud
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<your-web-client-id>.apps.googleusercontent.com
# iOS client id（可选，未实测）
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<your-ios-client-id>.apps.googleusercontent.com
```

**留空 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 时，登录页的 Google 按钮会自动回退**
到系统浏览器 OAuth（`GET /auth/google?mobile=1`），所以没申请凭据的开发环境
不会因此登录不了。

### 6.3 iOS 额外步骤（未实测）

iOS 需要把 iOS client id 的反向 URL Scheme 加进 `apps/mobile/app.json`：

```json
[
  "@react-native-google-signin/google-signin",
  { "iosUrlScheme": "com.googleusercontent.apps.<your-ios-client-id>" }
]
```

本仓**尚未**在 `app.json` 的 `plugins` 里加这一项（没有 iOS 设备可验证，
加了也无法确认 prebuild 结果）。要做 iOS 时再补。

---

## 七、接口契约

```
POST /api/v1/auth/google/native
Content-Type: application/json

{ "idToken": "<原生 SDK 返回的 Google ID token>" }
```

成功 **200**（与邮箱登录、Web OAuth 回调同口径）：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 900,
  "user": { "id": "...", "email": "...", "googleId": "..." }
}
```

失败：

| HTTP | code                      | 触发条件                                                         |
| ---- | ------------------------- | ---------------------------------------------------------------- |
| 422  | —（Pydantic 校验）        | `idToken` 缺失或不是 JWS compact 三段式                          |
| 401  | `OAUTH_ID_TOKEN_INVALID`  | 签名验不过 / `iss` 不对 / 缺 `exp` 或已过期 / `aud` 不在允许集合 |
| 400  | `OAUTH_EMAIL_UNAVAILABLE` | id_token 没有 email，或 `email_verified` 不为 true               |
| 503  | `OAUTH_NOT_CONFIGURED`    | 允许的 client id 集合为空（两个环境变量都没配）                  |
| 503  | `OAUTH_NETWORK_ERROR`     | 拉不到 Google JWKS 验签公钥                                      |

账号关联规则与 Web OAuth 完全一致（先按 `google_id` 命中，再按 email 自动关联，
都没有则新建 `hashed_password=NULL` 的 OAuth-only 用户），见
[oauth-setup.md §6](oauth-setup.md)。

---

## 八、常见失败

| 现象                                      | 原因                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| 原生 SDK 报 `DEVELOPER_ERROR`             | 包名或 SHA-1 与 Android OAuth 客户端登记的不一致（debug/release 搞混最常见） |
| 原生 SDK 报 `PLAY_SERVICES_NOT_AVAILABLE` | 模拟器镜像不带 Google Play；换带 Play Store 的镜像                           |
| 后端 401 `aud 不在允许的客户端 ID 列表内` | `GOOGLE_CLIENT_ID` / `GOOGLE_NATIVE_CLIENT_IDS` 没把实际 `aud` 列进去        |
| 后端 503 `OAUTH_NETWORK_ERROR`            | 服务器出不去外网，拉不到 `https://www.googleapis.com/oauth2/v3/certs`        |
| 装了依赖但原生模块报 undefined            | 用了 Expo Go；原生 SDK 必须 Development Build                                |

---

## 九、当前验证范围

已验证（本机实跑）：

- 后端 `backend/tests/integration/test_oauth_google_native.py` —— 测试内自签 RSA
  密钥对 + 本地 JWKS，走**真实 jose 验签路径**，覆盖建号 / 关联 / 多 audience /
  伪造签名 / 过期 / 错 `iss` / 未验证邮箱 / 未配置 / JWKS 不可达；
- 后端 `backend/tests/unit/test_oauth_google_jwks.py` —— JWKS TTL 缓存命中与过期重取；
- 移动端 `apps/mobile/src/lib/googleSignIn.test.ts` —— 取 token、取消、缺 id_token 分支。

**未验证**：

- 真机 / 模拟器上的完整原生登录链路（需要真实 Android OAuth 客户端，本次未申请）；
- iOS 全链路（无 macOS/iOS 设备）；
- `app.json` 加 `@react-native-google-signin/google-signin` 配置插件后的 prebuild 结果。
