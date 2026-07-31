# 移动端踩坑与解决记录（Phase 3）

本文件记录 Expo/React Native 端已复现并修复的问题：**根因**、**修法**、**如何验证**。
目的是让后续会话不再重复踩坑；每条都对应一个已合入的 commit。

> 排查方法论：先真机复现 → 埋点/日志拿实测数据 → 定位根因 → 修 → 真机验证。
> 不要用「最终态截图看着正常」代替验证（本轮就因此误判过两次）。

---

## 1. RN 0.76 Fabric：首帧后挂载的 Modal 内容 0 尺寸

**症状**：会话列表 ⋮ 菜单点开后整屏卡死——弹窗看不见但挡住所有触摸。

**根因**：新架构（Fabric/Bridgeless）下 `<Modal>` 若在首帧之后才挂载，内容拿不到窗口约束，
布局塌缩成 0×0：不可见但仍拦截触摸。首帧就存在的 Modal 不受影响。

**修法**（`e3bbeaa`）：统一弹窗弃用 RN `Modal`，改为 `DialogProvider` 根部绝对定位 overlay
（`StyleSheet.absoluteFillObject` + `zIndex/elevation: 1000`），硬件返回用 `BackHandler` 接管。

**注意**：`ArtifactSurface.tsx` 仍在用 `Modal`（首帧后挂载），同一缺陷未清除；
根治手段是升级 RN 补丁版，属独立任务。

**验证**：抽屉 → 任一会话 ⋮ → 弹层可见、可点、返回键可关。

---

## 2. NativeWind 4 丢弃函数式 Pressable style

**症状**：弹窗按钮/列表行样式失效（文字左对齐、无分隔线、无按压反馈）。

**根因**：NativeWind 的 cssInterop 包装 `Pressable` 后，`style={({pressed}) => ...}` 的**函数返回值被丢弃**。

**修法**（`e3bbeaa`）：改为静态 style 数组 + `android_ripple` 提供按压反馈。

---

## 3. zustand persist 在 RN 上读不到 token（冷启动掉登录页）

**症状**：登录后杀进程重开，回到登录页；SecureStore 里根本没有 auth 记录。

**根因**：`createJSONStorage(getStorage)` 的工厂函数在**模块加载时立即执行**，
此时 `setPlatformAdapter(mobileAdapter)` 还没跑，捕获到的是 Web 默认 adapter（RN 上是 no-op）。

**修法**（`c33429f`）：storage 换成惰性转发的 `StateStorage`（每次调用现取
`getPlatformAdapter()`），并在注册 mobileAdapter 之后手动 `persist.rehydrate()` 重放一次。

**验证**：登录 → `am force-stop` → 重开直接进 `/chat`；过期 access token 能自动 refresh。

---

## 4. react-native-sse 在服务端结束连接时不触发 close

**症状**：后端已返回 `error` 帧收尾，UI 永远停在流式光标。

**根因**：`react-native-sse`（`pollingInterval: 0`）在服务端主动关闭连接时不派发任何事件，
上层 `onClose` 永远不触发。

**修法**（`5e5534e`）：由终止帧推断流结束——收到 `message_end` **或带 payload 的 `error`** 即收尾。
（无 data 的 `error` 是传输层错误，仍走 `onError`。）

---

## 5. 认证页键盘遮挡提交按钮

**症状**：键盘弹起后「登录 / 注册并登录 / 重置密码」按钮被盖住一半，内容不上移。

**根因**：`react-native-keyboard-controller` v1.21 起 `KeyboardAwareScrollView` 默认 `insets` 模式，
只保证**获焦输入框**可见，输入框下方的提交按钮不在保证范围内。

**修法**（`7fbc0bc`）：`AuthShell` 加 `mode="layout"`（追加键盘高度的 spacer 触发 flex 重排），
居中内容整体顶起。三个认证页共用 AuthShell，一处改动全覆盖。

---

## 6. 停止流式后已输出内容消失（前后端双端兜底）

**症状**：点停止后，已经输出的文字整段没了。

**根因**：停止时 `finalizeStream()` 清掉流式占位行，而后端 assistant 占位消息此刻
`content` 仍是空串——占位行消失 + refetch 拿到空内容 = 界面上什么都不剩。

**修法**（`ad7d97c`）：

- 前端 `useStream.stop()`：关流**之前**把已收到的内容写进 `['messages', convId]` 查询缓存
  （消息 ID 取自 `message_start` 帧），并让 `onClose` 跳过 refetch，避免空占位覆盖；
- 后端 `_generate_sse` 捕获 `asyncio.CancelledError`，用**独立 session** 把部分内容落库
  （`asyncio.shield` 防止落库本身被取消；仅在占位仍为空时写，避免与正常收尾竞态双写）。

**验证**：数到 2000 → 5 秒时停止 → 界面保留已输出内容；DB 中 assistant 消息长度 > 0。
回归测试：`backend/tests/integration/test_chat.py::test_cancelled_stream_persists_partial_content`、
`packages/core/src/hooks/__tests__/useStream.test.tsx`（stop 写缓存用例）。

---

## 7. 流式 401 不刷新、不跳登录（SSE 绕过 axios 拦截器）

**症状**：token 过期后发消息弹「发送失败 AUTH_TOKEN_INVALID」，反复点还是同样错误，不跳登录页。

**根因**：401 自动刷新逻辑写在 axios 响应拦截器里，而 SSE 走的是
`react-native-sse` / `fetch`，根本不经过 axios。

**修法**（`ad7d97c`）：`packages/core/src/api/client.ts` 导出
`refreshAccessTokenForStream()`（与拦截器共用同一个 in-flight `refreshPromise`）；
`useStream.send` 在**尚未开流**就撞 401 时刷新并重试一次，刷新失败调 `onAuthFailure`
清 auth，由路由守卫重定向登录页。

---

## 8. 长回复渲染卡死 / ANR

**症状**：让 AI 数到 1000，界面卡死，系统弹「元AI isn't responding」。

**根因**：两处叠加——

1. 每个 token 都 `set` 一次 store，订阅者以每秒上百次的频率全量重渲染；
2. `markdown-it` 每次增量都重新 parse **全文**并重建全部 RN 节点。

**修法**（`ad7d97c` + `1f14b01`）：

- `useStream` 把 delta 缓冲 **80ms 合并**成一次 store 提交（终止/停止前 `flush` 防丢尾）；
- AI 回复在列表层按行切块，每块一个列表项 + 块级 `memo`，流式中只有末块重新 parse；
- `UserMessage` / `AIMessage` 套 `memo`，挡掉列表 recycle 引发的重渲染。

---

## 9. 长回复流式结束后整屏空白（最隐蔽的一个）

**症状**：数到 150 的回复，流式结束后**整屏空白且不会自恢复**；手动下滑才看到内容顶边。
数到 60 不复现。此前被误判为「停止后内容消失」和「不自动滚动到底部」。

**根因**（埋点实测，非推断）：单个列表条目高度远超视口时，RecyclerListView 的
**内容总高度与该条目的 layout 不一致**——同一帧里末项 `getLayout().height = 1365`，
而 `getContentDimension().height` 只有 `833`。按任一方计算出的贴底偏移都会超出 RLV
认知的内容范围，渲染窗口落到数据之外 → 什么都不渲染，且不会自恢复。
`scrollToOffset(内容高 - 视口高)` 与 `scrollToIndex(viewPosition: 1)` 都会命中。

**修法**（`1f14b01`）：**改结构，不再修偏移算法**——AI 回复在 `MessageList` 层按 12 行切块，
每块一个列表项，条目高度回到视口量级，估算与滚动数学恢复正常。
`AIMessage` 相应改为渲染单块，按首/末块控制头像与内边距（非首块用等宽占位保持左对齐）。

**教训**：recycler 不适合「单条目高度是视口好几倍」的场景；遇到长内容优先拆条目，
不要在滚动偏移上层层打补丁。

**验证**：数到 150 结束后精确停在底部无空白；数到 2000 中途停止内容保留。

---

## 10. 流式自动滚动的跟随模型

**症状**：流式输出不自动滚到底部；用户上滑后再也不跟随。

**根因 + 修法**（`c5c5baf`）：

- `FlashList.scrollToEnd` 底层是 `scrollToIndex(最后一项)`，语义是**滚到该项顶部**——
  条目拆块后这一点不再是问题，但仍需 `viewPosition: 1` 让末块底部对齐视口底部；
- 跟随态判定只在**用户手势期间**生效（`onScrollBeginDrag` 标记，程序化滚动不参与判定），
  否则程序滚动的中间帧会被误判成「用户上滑」而停止跟随；
- 进入会话时用低频（250ms）内容高度轮询渐进贴底——RLV 高度是分块渐进量出来的，
  单次滚动会停在「量到一半」的位置；
- 键盘弹起分 80/250/500ms 多时点重滚，覆盖 KAV 收缩动画时长（单次 50ms 会取到过期视口高度）。

策略：上滑暂停跟随、滑回底部附近（≤100px）自动恢复、发送新消息强制恢复。

---

## 11. 消息操作行不能挂在末块内

**症状**：给 AI 消息末块塞「版本切换 / 复制 / 重新生成 / 反馈」操作条后，
流式结束或版本切换时末块被顶出视口，且「回到底部」FAB 也不出现——
列表自认为已贴底，但视觉上末块看不到。

**根因**：操作条在思考块/内容布局完成后才异步长高，末块的 `layout.height`
比 RLV 拿到的 `contentDimension.height` 大数百像素。这是第 9 号问题的变体：
只要末块自身高度可能后于内容量出，滚动数学就会越界。

**修法**（未提交前的迭代）：把操作条抽成 `ActionsRow` 独立列表项
（`kind: 'actions'`），高度稳定且小；末块只承担正文与光标。

## 12. AI 回复切块处每 12 行多一条空行

**症状**：长回复按 12 行切块后，块与块之间视觉上多出一条 8px 空带，
观感上「像调试留下的空行」。

**根因**：`react-native-markdown-display` 的 paragraph/list 默认 `marginBottom = spacing.sm`，
每个切块最后一个 block 都吃到这份外边距；跨块又叠一份 `paddingVertical`，
在源文本本是「相邻非空行」的位置就多出一份视觉间距。

**修法**：切块时判断接缝两侧的行是否都非空——是则给该块加 `seamlessBottom` 标记
（`marginBottom: -spacing.sm`）吃掉外边距；真正的段落边界（任一侧空行）不加，
保留正常块间距。

## 13. 深度思考开关直接复用 prefs.showThinking

后端 `enable_thinking` 只对 DeepSeek 系列生效（`extra_body.thinking`）；
前端两端共享 `usePrefsStore.showThinking`，Web 侧已用，移动侧 ChatInput
直接读写同字段即可，发送时聊天页从 store `getState()` 取值传给 `useStream.send`
（用 getState 而非订阅：开关变化不必重渲聊天页）。

## 14. 消息交互一律直点，无长按菜单

**约束**：用户明确要求：所有消息操作（复制 / 编辑 / 重新生成 / 反馈）都做成
气泡下方的直点小图标，**不要**长按弹 ActionSheet，也**不要**反馈弹层。

- 用户气泡下：复制 / 编辑
- AI 消息下：版本切换 ‹ x/y › + 复制 / 重新生成 / 👍 / 👎
- 反馈是即点即记的 toggle（再点同一个 = 取消），只存内存（同 Web）
- 反馈图标激活态用 lucide 的 `fill` 属性变实心，不再改颜色边框
- 复制 / 点赞成功由居中 Toast 反馈（`components/ui/Toast.tsx`，深底白字）

---

## 调试手法备忘

- **真机埋点**：`console.log` → `adb logcat -d | grep -o "TAG.*"`，比截图推断可靠得多。
- **判断「空白」性质**：`adb shell uiautomator dump` 看节点是否存在。
  节点在 = 滚动位置问题；节点不在 = 渲染/数据问题。
- **稳定点击控件**：先 `uiautomator dump` 拿 `content-desc` 的实时 bounds 再 tap，
  不要用固定坐标（键盘弹起会整体位移）。
- **强制新 bundle**：`am force-stop` + 重新 launch，HMR 有时不生效会让你验证到旧代码。
- **模拟器崩溃后**：从旧快照恢复可能导致 App 丢失，
  用 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` 重装即可，无需重编原生。

## 15. react-syntax-highlighter v16 在 Metro 下的子路径坑

`react-native-syntax-highlighter@2.1.0` 按 v6 旧目录布局 require
`react-syntax-highlighter/styles/hljs`、`/prism`、`/create-element`；
v16 把实现全部挪进 `dist/cjs` 且根目录不再提供这些入口，而本项目 Metro
关闭了 package exports（见 metro.config.js 注释），于是直接红屏
"Unable to resolve module"。

**解法**（metro.config.js `rshCompat` 映射表）：

- `styles/hljs`、`styles/prism`、`create-element` → `dist/cjs/` 对应路径
- 裸入口与 `/prism` → `dist/cjs/default-highlight`（纯 hljs 组件）。
  不能映射到 `dist/cjs/index` 或 `dist/cjs/prism*`：它们 require
  `refractor/all`，refractor v5 只有 exports 子路径，Metro 关 exports 后
  解析不到，且会把全量 prism 语法打进 bundle。

另：`react-syntax-highlighter` 必须列为 apps/mobile 直接依赖（pnpm 隔离
布局下 rnsh 自带的 ^6 peer 不会提升，Metro 只能沿 app node_modules 找到）。

## 16. css-interop 无条件加载 reanimated 4 的 worklets 插件

`react-native-css-interop@0.2.6` 的 `babel.js` 固定 require
`react-native-worklets/plugin`（reanimated >= 4 专属包），本项目 pin
reanimated 3.16.x（worklets 插件在 `react-native-reanimated/plugin`，
babel.config.js 已挂）。清 Metro 缓存后必现
"Cannot find module 'react-native-worklets/plugin'"。

**解法**：pnpm patch 掉该 require（`patches/react-native-css-interop@0.2.6.patch`，
root package.json `pnpm.patchedDependencies` 生效）。升级 nativewind /
reanimated 4 时删 patch 重装即可。

## 17. Artifact 沙箱在 RN WebView 的差异点

- 控制台桥：core `CONSOLE_BOOTSTRAP` 检测 `window.ReactNativeWebView`
  存在则 `postMessage(JSON 字符串)`，否则回落 iframe `parent.postMessage`。
  WebView `onMessage` 收到的是字符串，需 `JSON.parse` 后按
  `ARTIFACT_MSG_SOURCE` 过滤。
- 暗色适配：`buildRunSrcDoc(lang, code, { dark })` 控制外壳底色/前景；
  WebView 自身 style 也要给同色 backgroundColor，避免加载瞬间白闪。
  用户完整 HTML 文档不注入主题（保留其自身样式）。
- `localStorage`：WebView `domStorageEnabled={false}`（沙箱不需要持久化），
  用户代码调用 localStorage 会抛错——属预期行为，错误会经桥显示在日志条。
- 纯计算 JS 无 DOM 输出时页面全空易误判失败：`buildJsDoc` 执行后延时
  检查 body，无可视内容则注入"代码已执行，无可视输出"提示。
