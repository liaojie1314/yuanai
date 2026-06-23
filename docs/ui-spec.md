# UI 设计规范

## 设计语言

**风格**: 现代渐变蓝紫，参考 Claude 设计语言  
**原则**: 温暖、克制、内容优先、高可读性

---

## 颜色系统

所有颜色通过 CSS 变量定义，支持明暗双主题。

### CSS 变量定义（在 `packages/ui/src/styles/tokens.css`）

```css
:root {
  /* === 背景色 === */
  --bg-base: #f4f8ff; /* 页面背景（淡蓝白） */
  --bg-surface: #ffffff; /* 侧边栏/面板背景 */
  --bg-elevated: #ebf3ff; /* 悬浮/选中状态 */
  --bg-overlay: rgba(0, 0, 0, 0.35); /* 遮罩 */

  /* === 文字色 === */
  --text-primary: #1a2540; /* 主要文字（深蓝黑） */
  --text-secondary: #5a6a8a; /* 次要文字 */
  --text-muted: #9babc5; /* 占位符/禁用 */
  --text-inverse: #ffffff; /* 深色背景上的文字 */

  /* === 品牌色（淡蓝） === */
  --brand-from: #3b82f6; /* 渐变起始（蓝） */
  --brand-to: #60a5fa; /* 渐变结束（淡蓝） */
  --brand-solid: #3b82f6; /* 单色品牌色（按钮等） */
  --brand-hover: #2563eb; /* 按钮 hover 色 */
  --brand-light: #eff6ff; /* 品牌色浅色背景 */
  --brand-muted: #bfdbfe; /* 品牌色边框/分隔 */

  /* === 边框 === */
  --border-default: #e5e7eb;
  --border-focus: #6366f1;

  /* === 功能色 === */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* === 代码块 === */
  --code-bg: #f8f9fa;
  --code-border: #e9ecef;
  --code-text: #1a1a2e;

  /* === 间距 === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* === 圆角 === */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* === 字体 === */
  --font-sans:
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
}

[data-theme='dark'] {
  --bg-base: #0f0f1a;
  --bg-surface: #1a1a2e;
  --bg-elevated: #242438;
  --bg-overlay: rgba(0, 0, 0, 0.6);

  --text-primary: #f1f1f5;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;

  --brand-light: #2d1b69;

  --border-default: #2d2d45;

  --code-bg: #1e1e2e;
  --code-border: #2d2d45;
  --code-text: #cdd6f4;
}
```

### Tailwind CSS v4 集成

在 `packages/ui/src/styles/tailwind.css` 中，通过 `@theme` 指令将 CSS 变量映射为 Tailwind 工具类：

```css
@import 'tailwindcss';
@import './tokens.css';

@theme {
  --color-bg-base: var(--bg-base);
  --color-bg-surface: var(--bg-surface);
  --color-text-primary: var(--text-primary);
  --color-brand: var(--brand-solid);
  /* ... 其余映射 */
}
```

---

## 字体规范

| 用途     | 大小 | 行高 | 字重        |
| -------- | ---- | ---- | ----------- |
| 页面标题 | 20px | 28px | 600         |
| 区块标题 | 16px | 24px | 600         |
| 正文     | 15px | 24px | 400         |
| 说明文字 | 13px | 20px | 400         |
| 代码     | 13px | 20px | 400（等宽） |
| 按钮     | 14px | 20px | 500         |
| 标签     | 12px | 16px | 500         |

---

## 布局规范

### 响应式断点

```
xs:    < 480px    手机竖屏
sm:    480-768px  手机横屏 / 小平板
md:    768-1024px 平板
lg:    1024-1280px 小桌面
xl:    > 1280px   大桌面
```

### 主布局结构

```
┌─────────────────────────────────────────────────┐
│  侧边栏 (260px)   │        主内容区域            │
│                   │                             │
│  [+ 新建对话]     │  ┌─────────────────────┐   │
│                   │  │     顶部工具栏        │   │
│  会话列表         │  │  模型切换 / 设置      │   │
│  ┌─────────────┐  │  └─────────────────────┘   │
│  │ 当前会话 ●  │  │                             │
│  │ 历史会话 1  │  │     消息流区域（可滚动）      │
│  │ 历史会话 2  │  │                             │
│  └─────────────┘  │  ┌─────────────────────┐   │
│                   │  │     输入区域（固定底）│   │
│  [用户头像/设置]  │  └─────────────────────┘   │
└───────────────────┴─────────────────────────────┘

移动端：侧边栏收起为抽屉，底部 Tab 导航
```

### 侧边栏

- 宽度: 260px（桌面），全屏（移动端抽屉）
- 背景: `var(--bg-surface)`
- 会话项高度: 44px
- 悬停: `var(--bg-elevated)`，圆角 `var(--radius-md)`
- 当前会话: 左侧 3px 品牌色竖线 + `var(--bg-elevated)` 背景

### 消息区域

- 最大宽度: 800px，水平居中
- 消息间距: 24px
- 用户消息：右对齐，品牌色浅背景气泡
- AI 消息：左对齐，`var(--bg-surface)` 背景（或无气泡，参考 Claude）

### 输入框

- 高度: 最小 52px，最大 200px（自动增高）
- 圆角: `var(--radius-xl)` 24px
- 边框: 1px `var(--border-default)`，focus 时 `var(--border-focus)`
- 内阴影（focus）: `0 0 0 3px rgba(99,102,241,0.15)`
- 发送按钮: 右侧内嵌，无内容时禁用（灰色），有内容时品牌渐变

---

## 核心组件规范

### Button

```
变体:
  primary    → 品牌渐变背景 (from-brand-from to-brand-to)，白色文字
  secondary  → bg-elevated，primary 文字色
  ghost      → 透明背景，hover 时 bg-elevated
  danger     → 红色背景，白色文字

尺寸:
  sm   → h-8  px-3  text-sm
  md   → h-10 px-4  text-sm  (默认)
  lg   → h-12 px-6  text-base

状态:
  disabled → opacity-50，不可点击
  loading  → 左侧 spinner，文字不变
```

### MessageBubble

```
用户消息:
  background: linear-gradient(135deg, var(--brand-from), var(--brand-to))
  color: white
  border-radius: 18px 18px 4px 18px
  max-width: 75%
  padding: 12px 16px
  align: right

AI 消息:
  background: transparent (无气泡，参考 Claude 风格)
  或 background: var(--bg-surface)
  border-radius: 18px 18px 18px 4px
  max-width: 100%
  padding: 0 (内容直接渲染)
  align: left
  带有 AI 头像（渐变圆形，首字母或 Logo）
```

### CodeBlock

```
结构:
  ┌──────────────────────────────────┐
  │ [语言标签]          [复制按钮]   │  ← header: bg-code-border
  ├──────────────────────────────────┤
  │  代码内容（monospace 字体）       │  ← bg-code-bg，横向滚动
  └──────────────────────────────────┘

语法高亮: shiki（Web/Desktop）/ react-native-syntax-highlighter（Mobile）
主题: 亮色 github-light，暗色 github-dark
```

### ModelSelector

```
样式: 顶部工具栏中央下拉按钮
显示: 当前模型名称 + Provider logo（小图标）+ 下拉箭头
下拉面板:
  - 按 Provider 分组（OpenAI / Anthropic / DeepSeek）
  - 每项显示: logo + 名称 + 简短描述 + 上下文长度
  - 当前选中项带品牌色勾选标记
```

### Avatar

```
尺寸: sm(24px) md(32px) lg(40px) xl(56px)
有头像: 圆形图片
无头像: 渐变背景 + 用户名首字母（大写）
AI 头像: 品牌渐变背景 + "Y"字 logo
```

---

## 动效规范

| 场景            | 动效                        | 时长              |
| --------------- | --------------------------- | ----------------- |
| 按钮 hover      | scale(1.02) + shadow        | 150ms ease        |
| 按钮 active     | scale(0.98)                 | 100ms ease        |
| 侧边栏展开/收起 | translateX slide            | 250ms ease-in-out |
| 对话切换        | opacity 0→1                 | 200ms ease        |
| 新消息出现      | translateY(8px)→0 + opacity | 200ms ease-out    |
| 流式文字        | 无动效（直接追加）          | —                 |
| 主题切换        | 所有颜色                    | 200ms ease        |
| 模态框          | scale(0.95)→1 + opacity     | 200ms ease-out    |

---

## 移动端特殊规范

### 安全区域

所有底部元素（输入框、导航栏）必须考虑 iPhone 底部 Home Indicator：

```tsx
// Expo: 使用 useSafeAreaInsets()
const insets = useSafeAreaInsets()
<View style={{ paddingBottom: insets.bottom + 8 }}>
```

### 触摸目标

最小触摸区域 44x44pt（Apple HIG 标准）

### 键盘行为

- 输入框获焦时，消息列表自动滚动到底部
- 键盘弹出时，输入区域随之上移（`KeyboardAvoidingView`）

### 平板适配（iPad / Android 平板）

屏幕宽度 ≥ 768px 时：

- 侧边栏固定展开（不折叠）
- 消息区域最大宽度 800px 居中

---

## 图标规范

- **图标库**: `lucide-react`（Web/Desktop）、`lucide-react-native`（Mobile）
- **默认尺寸**: 16px（内联）/ 20px（按钮）/ 24px（工具栏）
- **颜色**: 继承父元素文字色（`currentColor`）

---

## 无障碍规范

- 所有交互元素必须有 `aria-label` 或可见文本
- 颜色对比度满足 WCAG AA（正文 ≥ 4.5:1，大文字 ≥ 3:1）
- 支持键盘导航（Tab 顺序合理，Enter/Space 触发按钮）
- 支持系统字体大小缩放（不固定 px 字体大小）
