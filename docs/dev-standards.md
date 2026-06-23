# 开发规范

> 本文档是所有执行会话的硬性约束，**不得以任何理由跳过**。

---

## 一、TypeScript 规范

### tsconfig 根配置（`tsconfig.base.json`）

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "out", ".next", "coverage"]
}
```

### 强制规则

| 规则                         | 要求           | 说明                          |
| ---------------------------- | -------------- | ----------------------------- |
| 禁止 `any`                   | `error`        | 使用 `unknown` + 类型守卫替代 |
| 禁止非空断言 `!`             | `warn`         | 必须附注释说明安全原因        |
| 禁止 `as Type` 强转          | `warn`         | 用类型守卫或泛型替代          |
| 必须显式返回类型             | 公共函数必须写 | 非导出函数可推断              |
| 类型导入必须用 `import type` | `error`        | 避免运行时副作用              |
| 禁止未使用变量               | `error`        | 前缀 `_` 的变量除外           |
| 接口优先于 `type`（对象型）  | 推荐           | `type` 用于联合/交叉类型      |

### 命名约定

| 类型           | 风格                        | 示例                              |
| -------------- | --------------------------- | --------------------------------- |
| 变量、函数     | camelCase                   | `fetchMessages`, `userId`         |
| React 组件     | PascalCase                  | `MessageBubble`, `ChatInput`      |
| 类型、接口     | PascalCase                  | `Message`, `ConversationSummary`  |
| 枚举           | PascalCase，成员 PascalCase | `Role.User`                       |
| 常量（模块级） | UPPER_SNAKE                 | `MAX_RETRY_COUNT`                 |
| 组件文件       | PascalCase + `.tsx`         | `MessageBubble.tsx`               |
| 工具/Hook 文件 | kebab-case                  | `use-stream.ts`, `format-date.ts` |
| 测试文件       | 同源文件名 + `.test.ts(x)`  | `MessageBubble.test.tsx`          |

### import 顺序（ESLint 强制）

```typescript
// 1. Node 内置
import { readFile } from 'fs/promises'

// 2. 外部依赖
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

// 3. 内部包（@yuanai/*）
import type { Message } from '@yuanai/types'
import { useAuthStore } from '@yuanai/core/stores'

// 4. App 内部绝对路径（@/*）
import { ChatInput } from '@/components/ChatInput'

// 5. 相对路径
import { formatDate } from './utils'
import type { Props } from './types'
```

---

## 二、ESLint 配置

**工具链**：ESLint v9（flat config）+ TypeScript ESLint + React Hooks + Import 排序

### 根配置文件 `eslint.config.mjs`

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importPlugin from 'eslint-plugin-import'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/.expo/**',
      'backend/**', // 后端由 Ruff 处理
    ],
  },

  // JS 基础规则
  js.configs.recommended,

  // TypeScript 严格规则
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // React 规则
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // Import 排序
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          pathGroups: [
            { pattern: '@yuanai/**', group: 'internal', position: 'before' },
            { pattern: '@/**', group: 'internal', position: 'after' },
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',

      // 通用
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // 测试文件放宽（允许 console，不要求类型注解）
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Prettier 禁用格式类规则（最后一项）
  prettierConfig
)
```

### 各 App 的 `tsconfig.json`（继承并指定 projectService）

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx"
  },
  "include": ["src", "tests"]
}
```

---

## 三、Prettier 配置

### `.prettierrc`（根目录）

```json
{
  "semi": false,
  "singleQuote": true,
  "jsxSingleQuote": false,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

### `.prettierignore`

```
node_modules/
dist/
.next/
out/
coverage/
.expo/
*.lock
*.min.js
```

**执行命令**：

```bash
pnpm format          # 格式化所有文件
pnpm format:check    # CI 中只检查不修改
```

---

## 四、Python（后端）规范

### 工具链：Ruff + mypy

#### `backend/pyproject.toml`（规范相关部分）

```toml
[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = [
  "E",    # pycodestyle errors
  "W",    # pycodestyle warnings
  "F",    # pyflakes
  "I",    # isort
  "N",    # pep8-naming
  "UP",   # pyupgrade
  "ANN",  # flake8-annotations（类型注解必填）
  "B",    # flake8-bugbear
  "SIM",  # flake8-simplify
  "TCH",  # flake8-type-checking（TYPE_CHECKING 块）
  "RUF",  # ruff 专有规则
  "ASYNC",# 异步规则
]
ignore = [
  "ANN101",  # self 不需要注解
  "ANN102",  # cls 不需要注解
  "ANN401",  # 允许 Any（极少数情况）
]

[tool.ruff.lint.isort]
known-first-party = ["app"]
force-sort-within-sections = true

[tool.mypy]
python_version = "3.12"
strict = true
ignore_missing_imports = false
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
disallow_incomplete_defs = true
check_untyped_defs = true
```

### 命名约定

| 类型            | 风格              | 示例                                           |
| --------------- | ----------------- | ---------------------------------------------- |
| 变量、函数      | snake_case        | `fetch_messages`, `user_id`                    |
| 类              | PascalCase        | `UserService`, `ConversationModel`             |
| 常量            | UPPER_SNAKE       | `MAX_TOKEN_COUNT`                              |
| 文件            | snake_case        | `ai_service.py`                                |
| Pydantic Schema | PascalCase + 后缀 | `CreateConversationRequest`, `MessageResponse` |

### 强制规则

- 所有公共函数/方法必须有**完整类型注解**（mypy strict 强制）
- 禁止裸 `except:` 或 `except Exception:`，必须捕获具体异常类型
- 所有数据库操作必须使用 **async**（禁止同步 SQLAlchemy Session）
- 路由函数只做参数解析 + 调用 service，**禁止**在路由层写业务逻辑
- Service 层禁止直接 import 路由相关对象

---

## 五、Git 工作流

### 分支策略

```
main          ← 生产分支（保护，只接受来自 dev 的 PR，要求 CI 全绿）
└── dev       ← 集成分支（所有功能分支合并到这里）
    ├── feat/phase-0-scaffold
    ├── feat/auth-api
    ├── feat/chat-streaming
    ├── feat/web-login-page
    ├── fix/message-render-overflow
    └── test/auth-integration
```

**分支命名规则**：

| 类型     | 格式                  | 示例                        |
| -------- | --------------------- | --------------------------- |
| 新功能   | `feat/<简短描述>`     | `feat/streaming-chat`       |
| Bug 修复 | `fix/<简短描述>`      | `fix/token-refresh-race`    |
| 测试补充 | `test/<简短描述>`     | `test/chat-api-integration` |
| 文档     | `docs/<简短描述>`     | `docs/api-design-update`    |
| 重构     | `refactor/<简短描述>` | `refactor/ai-service-layer` |
| 工程配置 | `chore/<简短描述>`    | `chore/upgrade-expo-sdk`    |

**规则**：

- 禁止直接 push 到 `main` 或 `dev`
- 功能分支应保持小颗粒度（单一功能点，通常不超过 300 行变更）
- 合并前必须本地通过完整测试（见第六节 Husky）

---

## 六、提交规范（Conventional Commits）

### 格式

```
<type>(<scope>): <subject>

[可选 body，72 字符换行]

[可选 footer，如 BREAKING CHANGE: 或 Closes #123]
```

### Type 清单

| type       | 用途                       |
| ---------- | -------------------------- |
| `feat`     | 新功能                     |
| `fix`      | Bug 修复                   |
| `refactor` | 重构（非 feat/fix）        |
| `test`     | 新增/修改测试              |
| `style`    | 代码格式调整（不影响逻辑） |
| `chore`    | 构建/工具/依赖/配置变更    |
| `docs`     | 文档修改                   |
| `perf`     | 性能优化                   |
| `ci`       | CI/CD 流程修改             |
| `revert`   | 回滚提交                   |

### Scope 清单（对应目录/模块）

`web` | `mobile` | `desktop` | `backend` | `ui` | `core` | `types` | `e2e` | `config`

### Subject 规则

- **小写**开头（中文可不限）
- **不加句号**
- 最多 **72 字符**
- 使用**祈使句**（英文）：`add`, `fix`, `update`，不用 `added`, `fixed`

### 合法示例

```
feat(backend): add SSE streaming endpoint for chat
fix(web): resolve markdown code block overflow on narrow screens
test(backend): add integration tests for auth register endpoint
chore: upgrade turborepo to 2.3 and pnpm to 9.14
feat(core): implement useStream hook with retry logic
docs: update api-design with file upload size limits
```

### 非法示例（commitlint 会拒绝）

```
❌ 修改了登录页                    # 无 type
❌ feat: 修改了登录页。             # 加句号
❌ Feature: add login page         # type 首字母大写
❌ feat(web): Add login page       # subject 首字母大写
❌ feat(unknown-scope): xxx        # 非法 scope
```

### commitlint 配置

安装依赖：

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

根目录创建 `commitlint.config.mjs`：

```js
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'style', 'chore', 'docs', 'perf', 'ci', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      ['web', 'mobile', 'desktop', 'backend', 'ui', 'core', 'types', 'e2e', 'config'],
    ],
    'scope-empty': [1, 'never'], // scope 推荐填写（warning 级别）
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
}
```

---

## 七、Husky Git Hooks

### 安装与初始化

```bash
pnpm add -D husky lint-staged
pnpm husky init
```

### Hook 1：`pre-commit`（每次 commit 前）

**触发内容**：lint-staged（只处理本次变更的文件）

`.husky/pre-commit`：

```bash
#!/bin/sh
pnpm lint-staged
```

根 `package.json` 中的 `lint-staged` 配置：

```json
{
  "lint-staged": {
    "**/*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "**/*.{js,mjs,cjs}": ["prettier --write"],
    "**/*.{json,md,yaml,yml,css}": ["prettier --write"],
    "backend/**/*.py": ["ruff check --fix", "ruff format"]
  }
}
```

**要点**：

- `--max-warnings 0`：ESLint 警告也视为失败（不允许 warning 提交）
- lint-staged 只处理 `git add` 暂存的文件，速度快

### Hook 2：`commit-msg`（校验 commit message）

`.husky/commit-msg`：

```bash
#!/bin/sh
pnpm commitlint --edit "$1"
```

**效果**：不符合 Conventional Commits 格式的提交立即被拒绝，并显示具体错误。

### Hook 3：`pre-push`（push 前）

**触发内容**：TypeScript 类型检查 + 快速单元测试（不含 E2E）

`.husky/pre-push`：

```bash
#!/bin/sh

echo "⏳ Running type check..."
pnpm typecheck || { echo "❌ Type check failed. Push aborted."; exit 1; }

echo "⏳ Running unit tests..."
pnpm test:unit || { echo "❌ Unit tests failed. Push aborted."; exit 1; }

echo "⏳ Running backend tests..."
cd backend && uv run pytest tests/unit -x -q || { echo "❌ Backend unit tests failed. Push aborted."; exit 1; }

echo "✅ All checks passed. Pushing..."
```

**注意**：

- `pre-push` 只跑**单元测试**（秒级完成），集成测试和 E2E 交由 CI 执行
- `-x` 参数：第一个失败就停止，快速反馈
- 若需临时跳过（紧急情况）：`git push --no-verify`，但必须在 PR 说明中注明原因

---

## 八、lint-staged 完整配置

```json
{
  "lint-staged": {
    "apps/**/*.{ts,tsx}": ["eslint --fix --max-warnings 0 --no-warn-ignored", "prettier --write"],
    "packages/**/*.{ts,tsx}": [
      "eslint --fix --max-warnings 0 --no-warn-ignored",
      "prettier --write"
    ],
    "apps/**/*.{json,css}": ["prettier --write"],
    "*.{json,md,yaml,yml}": ["prettier --write"],
    "backend/**/*.py": ["ruff check --fix --select I", "ruff format"]
  }
}
```

---

## 九、根目录 Scripts 完整清单

根 `package.json`：

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint -- --fix",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,mjs,json,md,yaml,css}\" --ignore-path .prettierignore",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,mjs,json,md,yaml,css}\"",
    "test": "turbo run test",
    "test:unit": "turbo run test:unit",
    "test:integration": "turbo run test:integration",
    "test:e2e": "turbo run test:e2e",
    "test:coverage": "turbo run test:coverage",
    "prepare": "husky"
  }
}
```

每个 app/package 的 `package.json` 对应：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --reporter=verbose src/**/*.test.ts",
    "test:integration": "vitest run --reporter=verbose tests/integration",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch"
  }
}
```

---

## 十、CI/CD 管道规范（GitHub Actions）

`.github/workflows/ci.yml` 核心步骤（按顺序，任一失败则终止）：

```yaml
steps:
  - name: Install dependencies
    run: pnpm install --frozen-lockfile

  - name: Type check (all packages)
    run: pnpm typecheck

  - name: Lint (all packages)
    run: pnpm lint

  - name: Format check
    run: pnpm format:check

  - name: Unit tests (frontend)
    run: pnpm test:unit

  - name: Unit tests (backend)
    run: cd backend && uv run pytest tests/unit -v --tb=short

  - name: Integration tests (frontend)
    run: pnpm test:integration

  - name: Integration tests (backend)
    run: cd backend && uv run pytest tests/integration -v --tb=short

  - name: E2E tests
    run: pnpm test:e2e
    # 仅在 PR 到 main/dev 时运行

  - name: Coverage check
    run: |
      pnpm test:coverage
      cd backend && uv run pytest --cov=app --cov-fail-under=70
```

---

## 十一、代码审查规范

**PR 检查清单**（合并前必须满足）：

- [ ] CI 所有步骤绿灯
- [ ] 新功能有对应的单元测试
- [ ] 关键流程有对应的集成测试
- [ ] 无 `TODO` / `FIXME` 遗留（或已创建 Issue 追踪）
- [ ] `packages/types` 中新增类型与后端 Schema 保持一致
- [ ] 无多余的 `console.log`（ESLint 已强制，但 Review 再确认）
- [ ] 敏感信息（API Key、密码）无硬编码

**PR 标题**：必须符合 Conventional Commits 格式（commitlint 检查 PR 标题）

---

## 十二、错误处理规范

### 前端

```typescript
// ✅ 正确：明确的错误类型 + 用户反馈
try {
  await sendMessage(content)
} catch (error) {
  if (error instanceof ApiError) {
    toast.error(error.message)
    if (error.code === 'AUTH_TOKEN_EXPIRED') {
      logout()
    }
  } else {
    toast.error('发送失败，请重试')
    console.error('Unexpected error:', error)
  }
}

// ❌ 错误：吞掉错误
try {
  await sendMessage(content)
} catch {
  /* 什么都不做 */
}
```

### 后端

```python
# ✅ 正确：捕获具体异常，转为 HTTP 错误
async def create_conversation(req: CreateConversationRequest, db: DB) -> ConversationResponse:
    try:
        return await conversation_service.create(req, db)
    except ConversationLimitError as e:
        raise HTTPException(
            status_code=429,
            detail={"code": "CONVERSATION_LIMIT_EXCEEDED", "message": str(e)}
        ) from e

# ❌ 错误：裸 except
try:
    result = await something()
except:          # 禁止
    pass
```

---

## 十三、性能规范

### 前端

- 消息列表使用 `@tanstack/react-virtual` 虚拟滚动，不限制消息数
- 图片上传前端压缩：`canvas` 压缩到最大 2048px，JPEG quality 0.85
- API 列表接口超过 100 条必须分页（cursor-based）
- 组件性能：`React.memo` + `useCallback` 用于大列表渲染项
- Bundle 分析：`pnpm build --analyze` 检查包体积，单个 chunk 不超过 500KB

### 后端

- 所有数据库查询必须有适当的索引（迁移文件中显式声明）
- N+1 查询检测：使用 `joinedload` 或 `selectinload` 预加载关联数据
- 接口响应时间目标：P99 < 500ms（非 AI 接口），AI 流式接口首 token < 3s
- AI 调用必须有超时设置（`timeout=60s`）和错误重试（最多 2 次）
