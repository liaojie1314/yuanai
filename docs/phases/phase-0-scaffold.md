# Phase 0 — Monorepo 脚手架搭建

> 本文是早期脚手架设计记录。当前仓库运行时已固定为 Node.js `22.21.1`、pnpm `10.22.0`
> 和 Turborepo `2.10.7`；安装、启动和验证请以 [开发运行指南](../dev-guide.md) 与根
> `package.json` 为准。

**前置条件**: 已安装 Node.js 22+、pnpm 9+、Python 3.12+、Git  
**预计耗时**: 2-3 小时  
**执行会话**: 独立会话，执行完毕后提交到 `feat/phase-0-scaffold` 分支

---

## 目标

搭建完整的 Monorepo 骨架，包含：

1. Turborepo + pnpm workspace 配置
2. 三个 app（web / mobile / desktop）骨架
3. 三个 shared package（ui / core / types）骨架
4. TypeScript、ESLint、Prettier 统一配置
5. Husky + lint-staged pre-commit hook
6. 后端 FastAPI 项目骨架

---

## Step 1：初始化 Monorepo 根目录

在 `E:\cache\code\project\yuanai` 目录下执行：

```bash
# 初始化 pnpm workspace
pnpm init

# 安装 turbo 为开发依赖
pnpm add -D turbo@latest
```

创建 `pnpm-workspace.yaml`：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

创建根 `turbo.json`：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**", "out/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

更新根 `package.json`：

```json
{
  "name": "yuanai",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
    "prepare": "husky"
  },
  "devDependencies": {}
}
```

---

## Step 2：TypeScript 根配置

创建 `tsconfig.base.json`（根目录）：

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "incremental": false,
    "isolatedModules": true,
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleDetection": "force",
    "moduleResolution": "NodeNext",
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "exclude": ["node_modules"]
}
```

---

## Step 3：ESLint + Prettier 根配置

```bash
pnpm add -D \
  eslint@9 \
  @eslint/js \
  typescript-eslint \
  eslint-config-prettier \
  eslint-plugin-import \
  prettier
```

创建 `eslint.config.mjs`（根目录，ESLint v9 flat config）：

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**'],
  }
)
```

创建 `.prettierrc`：

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

创建 `.prettierignore`：

```
node_modules
dist
.next
out
*.lock
```

---

## Step 4：创建 packages/types

```bash
mkdir -p packages/types/src
cd packages/types
pnpm init
```

`packages/types/package.json`：

```json
{
  "name": "@yuanai/types",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

`packages/types/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "Preserve",
    "moduleResolution": "Bundler"
  },
  "include": ["src"]
}
```

`packages/types/src/index.ts`：（骨架，后续扩充）

```typescript
// ============ 枚举 ============
export enum Role {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

// ============ 用户 ============
export interface User {
  id: string
  email: string
  username: string
  avatarUrl: string | null
  createdAt: string
}

// ============ 会话 ============
export interface Conversation {
  id: string
  title: string
  model: string
  isPinned: boolean
  lastMessageAt: string | null
  createdAt: string
}

// ============ 消息 ============
export interface MessageFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
}

export interface Message {
  id: string
  role: Role
  content: string
  model?: string
  tokensUsed?: number
  files: MessageFile[]
  createdAt: string
}

// ============ 模型 ============
export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
  supportsVision: boolean
  supportsFiles: boolean
  contextLength: number
  isDefault: boolean
}

// ============ API 响应 ============
export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ApiError {
  code: string
  message: string
  detail?: string | null
}

// ============ SSE 事件 ============
export interface SSEMessageStart {
  type: 'message_start'
  userMessageId: string
  assistantMessageId: string
  model: string
}

export interface SSEContentDelta {
  type: 'content_delta'
  token: string
}

export interface SSEMessageEnd {
  type: 'message_end'
  tokensUsed: number
  finishReason: string
}

export interface SSEError {
  type: 'error'
  code: string
  message: string
}

export type SSEEvent = SSEMessageStart | SSEContentDelta | SSEMessageEnd | SSEError
```

---

## Step 5：创建 packages/core

```bash
mkdir -p packages/core/src/{api,stores,hooks,utils}
cd packages/core
pnpm init
```

`packages/core/package.json`：

```json
{
  "name": "@yuanai/core",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./stores": "./src/stores/index.ts",
    "./hooks": "./src/hooks/index.ts",
    "./api": "./src/api/index.ts",
    "./utils": "./src/utils/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@yuanai/types": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "axios": "^1.7.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "react": "^19.0.0",
    "typescript": "^5.7.0"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  }
}
```

创建骨架文件 `packages/core/src/index.ts`：

```typescript
// 主入口，统一导出
export * from './api/index'
export * from './stores/index'
export * from './hooks/index'
export * from './utils/index'
```

创建 `packages/core/src/api/client.ts`：

```typescript
import axios from 'axios'

const API_BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ??
  process.env['EXPO_PUBLIC_API_URL'] ??
  'http://localhost:8000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: 自动注入 token
apiClient.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Response interceptor: 401 自动刷新 token
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // TODO: Phase 1 后端完成后实现 token 刷新逻辑
    return Promise.reject(error)
  }
)

function getStoredToken(): string | null {
  // 平台差异由各 app 通过 setTokenGetter 注入
  return tokenGetter?.() ?? null
}

let tokenGetter: (() => string | null) | null = null

export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}
```

创建 `packages/core/src/api/index.ts`（导出入口）：

```typescript
export { apiClient, setTokenGetter } from './client'
```

创建骨架 stores/index.ts、hooks/index.ts、utils/index.ts（空导出即可，Phase 1 后填充）：

```typescript
// packages/core/src/stores/index.ts
export {}

// packages/core/src/hooks/index.ts
export {}

// packages/core/src/utils/index.ts
export {}
```

---

## Step 6：创建 packages/ui

```bash
mkdir -p packages/ui/src/{components,styles,tokens}
cd packages/ui
pnpm init
```

`packages/ui/package.json`：

```json
{
  "name": "@yuanai/ui",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./styles": "./src/styles/index.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "react": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  }
}
```

创建 `packages/ui/src/lib/cn.ts`（Tailwind 合并工具）：

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

创建 `packages/ui/src/index.ts`：

```typescript
export { cn } from './lib/cn'
// 组件在 Phase 2 实现后陆续 export
```

---

## Step 7：创建 apps/web（Next.js 15）

```bash
cd apps
pnpm create next-app@latest web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

安装内部依赖：

```bash
cd web
pnpm add @yuanai/types@workspace:* @yuanai/core@workspace:* @yuanai/ui@workspace:*
```

更新 `apps/web/package.json` 的 scripts：

```json
{
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  }
}
```

创建 `apps/web/.env.example`：

```
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

## Step 8：创建 apps/mobile（Expo）

```bash
cd apps
pnpm create expo-app@latest mobile \
  --template blank-typescript
```

安装依赖：

```bash
cd mobile
pnpm add @yuanai/types@workspace:* @yuanai/core@workspace:* nativewind
pnpm add -D tailwindcss
```

创建 `apps/mobile/.env.example`：

```
EXPO_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

## Step 9：创建 apps/desktop（Electron）

```bash
mkdir -p apps/desktop/src/{main,renderer,preload}
cd apps/desktop
pnpm init
```

`apps/desktop/package.json`：

```json
{
  "name": "@yuanai/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@yuanai/types": "workspace:*",
    "@yuanai/core": "workspace:*",
    "@yuanai/ui": "workspace:*",
    "electron-updater": "^6.3.0"
  },
  "devDependencies": {
    "@electron-toolkit/preload": "^3.0.0",
    "@electron-toolkit/utils": "^3.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

---

## Step 10：创建 backend/ 骨架

```bash
mkdir -p backend/app/{api/v1,models,schemas,services,core}
mkdir -p backend/{alembic,tests}
cd backend
```

创建 `backend/pyproject.toml`：

```toml
[project]
name = "yuanai-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi[standard]>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "sqlalchemy[asyncio]>=2.0.0",
  "asyncpg>=0.30.0",
  "alembic>=1.14.0",
  "pydantic>=2.10.0",
  "pydantic-settings>=2.6.0",
  "python-jose[cryptography]>=3.3.0",
  "passlib[bcrypt]>=1.7.4",
  "redis[asyncio]>=5.2.0",
  "openai>=1.57.0",
  "boto3>=1.35.0",
  "python-multipart>=0.0.17",
]

[tool.uv]
dev-dependencies = [
  "pytest>=8.3.0",
  "pytest-asyncio>=0.24.0",
  "httpx>=0.28.0",
  "ruff>=0.8.0",
  "mypy>=1.13.0",
]

[tool.ruff]
target-version = "py312"
line-length = 100
select = ["E", "W", "F", "I", "N", "UP", "B", "SIM", "ANN"]
ignore = ["ANN101", "ANN102", "ANN401"]

[tool.mypy]
python_version = "3.12"
strict = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

创建 `backend/.env.example`：

```
DATABASE_URL=postgresql+asyncpg://yuanai:password@localhost:5432/yuanai
REDIS_URL=redis://localhost:6379/0
JWT_SECRET_KEY=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# AI Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...

# S3 Storage
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=yuanai-files
S3_PUBLIC_URL=http://localhost:9000/yuanai-files
```

创建 `backend/app/main.py`：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="yuanai API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

---

## Step 11：Husky + lint-staged + commitlint（完整 Hook 体系）

### 安装依赖

```bash
pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional
pnpm husky init
```

### 创建三个 Hook 文件

**.husky/pre-commit**（lint-staged，每次 commit 前）：

```bash
#!/bin/sh
pnpm lint-staged
```

**.husky/commit-msg**（commitlint，校验 commit message 格式）：

```bash
#!/bin/sh
pnpm commitlint --edit "$1"
```

**.husky/pre-push**（typecheck + 单元测试，push 前）：

```bash
#!/bin/sh
echo "⏳ Running type check..."
pnpm typecheck || { echo "❌ Type check failed."; exit 1; }

echo "⏳ Running unit tests..."
pnpm test:unit || { echo "❌ Unit tests failed."; exit 1; }

echo "⏳ Running backend unit tests..."
cd backend && uv run pytest tests/unit -x -q 2>/dev/null || { echo "❌ Backend tests failed."; exit 1; }

echo "✅ All checks passed."
```

### commitlint 配置（根目录 `commitlint.config.mjs`）

```js
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
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
}
```

### lint-staged 配置（根 `package.json`）

```json
{
  "lint-staged": {
    "apps/**/*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "packages/**/*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "**/*.{js,mjs,cjs,json,md,yaml,yml,css}": ["prettier --write"],
    "backend/**/*.py": ["ruff check --fix", "ruff format"]
  }
}
```

---

## Step 12：创建 docker-compose.yml（开发环境）

在根目录创建 `docker-compose.yml`：

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: yuanai
      POSTGRES_USER: yuanai
      POSTGRES_PASSWORD: password
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

## Step 13：创建 .gitignore

在根目录创建 `.gitignore`：

```gitignore
# 依赖
node_modules/
.pnpm-store/
__pycache__/
*.pyc
.venv/
.uv/

# 构建产物
dist/
.next/
out/
build/
*.egg-info/

# 环境变量
.env
.env.local
.env.production

# 编辑器
.idea/
.vscode/settings.json
*.swp

# 系统
.DS_Store
Thumbs.db

# Turbo
.turbo/

# 测试
coverage/
.pytest_cache/

# Expo
.expo/
```

---

## Step 14：测试工具链安装

### packages/core 和 packages/ui（Vitest + RTL）

```bash
# packages/core
cd packages/core
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom \
  msw jsdom @types/jsdom

# packages/ui（同上）
cd packages/ui
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom jsdom
```

每个包中创建 `vitest.config.ts`（参见 `docs/testing-standards.md` 第二节）。

创建 `tests/setup.ts` 和 `tests/mocks/` 目录（参见 `docs/testing-standards.md` 第三节）。

### apps/web（Vitest + Playwright）

```bash
cd apps/web
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom \
  msw jsdom

# Playwright（E2E）
pnpm add -D @playwright/test
```

本项目不下载 Playwright 浏览器。E2E 需要浏览器时使用已有系统浏览器（Linux 优先为
`/usr/bin/google-chrome`）或测试配置中的已有 `executablePath`。

创建 `playwright.config.ts`（参见 `docs/testing-standards.md` 第七节）。

### backend（pytest 补充依赖）

```bash
cd backend
# 在 pyproject.toml [tool.uv] dev-dependencies 中补充：
# "pytest-postgresql>=6.0.0",
# "factory-boy>=3.3.0",
# "freezegun>=1.5.0",
# "coverage>=7.6.0",
uv sync
```

创建 `tests/conftest.py`、`tests/factories.py`、`tests/unit/`、`tests/integration/` 目录骨架（参见 `docs/testing-standards.md` 第八节）。

### 更新根 package.json scripts

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,tsx,js,mjs,json,md,yaml,css}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,mjs,json,md,yaml,css}\"",
    "test": "turbo run test",
    "test:unit": "turbo run test:unit",
    "test:integration": "turbo run test:integration",
    "test:coverage": "turbo run test:coverage",
    "prepare": "husky"
  }
}
```

### 每个 app/package 的 scripts 补充

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run src",
    "test:integration": "vitest run tests/integration",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest"
  }
}
```

---

## 验收标准

完成后在根目录执行以下命令，全部通过视为成功：

```bash
# 安装所有依赖
pnpm install

# 类型检查（所有包）
pnpm typecheck

# Lint（含 max-warnings 0，警告也视为失败）
pnpm lint

# 格式检查
pnpm format:check

# 启动开发环境基础设施
docker-compose up -d

# 验证 commit-msg hook（提交一条符合格式的 commit）
git add . && git commit -m "chore(config): init monorepo scaffold"
# 应成功提交；如提交 "修改配置" 则应被 commitlint 拒绝

# 验证 pre-push hook（空测试集应直接通过）
pnpm test:unit

# 启动后端
cd backend && uv run uvicorn app.main:app --reload
# 访问 http://localhost:8000/health → {"status":"ok"}

# 启动 Web
cd apps/web && pnpm dev
# 访问 http://localhost:3000 → Next.js 默认页面
```

所有命令无报错，且 commitlint 正确拦截非法格式提交，即完成 Phase 0。
