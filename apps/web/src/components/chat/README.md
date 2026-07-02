# apps/web/src/components/chat

聊天界面业务组件模块。`ChatInterface.tsx` 只保留外壳（侧边栏、工具栏、输入框、弹层），
消息渲染、思考过程、工具调用、代码运行、右侧定位等业务逻辑全部在本目录内。

## 组件清单

| 文件                 | 职责                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `MessageList.tsx`    | `react-virtuoso` 虚拟列表容器；粘底 / 自动跟随 / 变高消息                      |
| `MessageOutline.tsx` | 右侧 minimap 缩略条；点击 pair 调 `virtuosoRef.scrollToIndex` 平滑跳转         |
| `UserMessage.tsx`    | 用户气泡；复制（Markdown / 纯文本）+ 内联编辑                                  |
| `AIMessage.tsx`      | AI 消息；思考块 + Markdown 正文 + 复制 / 重新生成 / 反馈 / 版本切换 / 追问按钮 |
| `ThinkBlock.tsx`     | 思考过程折叠区；三种数据源（推理文字 / 工具调用列表 / 流式活跃态 shimmer）     |
| `ToolCallRow.tsx`    | 单个工具调用；展开显示完整参数 JSON + 结果 / 错误 + 状态徽标                   |
| `CodeBlock.tsx`      | 代码块；复制 / 在面板中查看 / 运行（仅 HTML/CSS/JS）三按钮                     |
| `ArtifactPanel.tsx`  | 右侧滑出面板；`view` 只读代码 / `run` iframe 沙箱执行                          |
| `MediaPart.tsx`      | 图片 / 音频 / 视频通用渲染（含骨架屏 + 加载失败降级）                          |
| `utils.ts`           | 纯函数工具：会话/消息适配、消息对分组、Markdown 剥离、iframe srcdoc 构造       |

## 数据流

1. **历史消息** → TanStack Query 缓存（`useMessages`），组件通过 `apiMsgToMock` 适配。
2. **流式状态** → Zustand `useChatStore`：`streamingContent` / `streamingThink` / `streamingToolCalls`。
   `useStream()` 解析 SSE 事件并写入 store，UI 订阅并渲染。
3. **Artifact 面板** → Zustand `useArtifactStore`：`CodeBlock` 点击 `openView`/`openRun`，
   `ArtifactPanel` 订阅 `open + payload` 自行渲染，两者完全解耦。
4. **消息 → 虚拟列表**：`ChatInterface` 用 `buildPairs()` 把扁平消息分组成 (userMsg, assistants[]) 对，
   传给 `MessageList`；`MessageList` 内部推导 `Row[]` 序列（user / ai / opt-user / stream-ai），
   `MessageOutline` 依据 pair 数量映射 minimap，点击的 index 换算为 rowIndex = pairIdx \* 2。

## SSE 事件

| 事件              | 处理                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `message_start`   | 识别但不影响 UI（后端消息 ID 由 refetch 时统一拉取）                |
| `content_delta`   | `chatStore.appendToken` 累积到 `streamingContent`                   |
| `thinking_delta`  | `chatStore.appendThink` 累积到 `streamingThink`（同时记录起始时间） |
| `tool_call_start` | `chatStore.startToolCall` 追加一条工具调用（`status: running`）     |
| `tool_call_delta` | `chatStore.appendToolCallArgs` 拼接参数分片                         |
| `tool_call_end`   | `chatStore.updateToolCall` 合并 status/result/error/durationMs      |
| `message_end`     | 识别但不影响 UI                                                     |
| `error`           | 识别但不影响 UI（`fetch` 层抛错，UI 由 `onError` 回调处理）         |
| 未知事件          | 静默忽略（保证后端向前兼容）                                        |

## 代码运行沙箱

`ArtifactPanel` 的 `run` 模式使用 `<iframe sandbox="allow-scripts allow-forms" srcDoc={...}>`。
`srcDoc` 由 `utils.ts#buildRunSrcDoc()` 根据代码语言生成：

- HTML → 原样嵌入（或包一层 `<html>` 骨架）
- CSS → 注入 `<style>` + 一段示例 body 展示样式效果
- JS → 注入 `<script>` + 空 `#app` 容器

安全策略：

- `sandbox="allow-scripts allow-forms"`：允许脚本与表单，禁止顶层导航、同源、弹窗。
- 未配 `allow-same-origin`：脚本无法访问父页面的 cookie / localStorage / DOM。
- 无网络放行：`srcDoc` 内部的相对资源请求都会失败。

其他语言（Python / TypeScript / SQL 等）**不显示"运行"按钮**，仅提供"在面板中查看"。

## 右侧消息定位

- Pair 数 < 3 时整个 `<nav>` 不渲染，避免小对话噪音。
- 每个 pair 一个按钮；高度按用户消息字符数归一化到 8~24px。
- `< 768px` 视口通过 CSS `display: none` 隐藏，让消息主区拿回全部宽度。

## Mock 演示流程

`apps/web/src/mocks/handlers.ts` `/chat/stream` 的完整事件序列：

```
message_start
  → thinking_delta × N (逐段推理文本)
  → tool_call_start (search_web)
    → tool_call_delta × N (参数分片)
    → tool_call_end (status: done, result)
  → tool_call_start (read_docs)
    → ...
  → content_delta × N (正文，含一段 HTML/JS 代码块用于"运行"演示)
  → message_end
```

运行 `pnpm --filter @yuanai/web dev:mock` → 发送任意消息即可完整走一遍。

## 单元测试

`__tests__/` 目录覆盖：

- `CodeBlock` 三按钮 / 语言判断 / 剪贴板
- `ToolCallRow` 三状态渲染 + 展开
- `ThinkBlock` shimmer / 折叠 / duration / toolCalls
- `UserMessage` 复制 MD / 纯文本 / 编辑触发
- `ArtifactPanel` view/run 双模式 / 关闭清空
- `MessageOutline` 阈值 / 点击映射 / active 高亮

对应 store / hook 测试在 `packages/core/src/{stores,hooks}/__tests__/`。
