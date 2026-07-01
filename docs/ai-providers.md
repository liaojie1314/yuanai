# AI 大模型接入指南

## 概览

后端通过统一的 OpenAI 兼容接口对接多家模型提供商。**只配置你需要的 Key 即可**——未填写 Key 的模型不会出现在前端模型选择列表中。

| 模型 ID                      | 名称              | 提供商    | 获取 Key                                                             |
| ---------------------------- | ----------------- | --------- | -------------------------------------------------------------------- |
| `deepseek-v4-flash`          | DeepSeek V4 Flash | DeepSeek  | [platform.deepseek.com](https://platform.deepseek.com/api_keys)      |
| `deepseek-v4-pro`            | DeepSeek V4 Pro   | DeepSeek  | [platform.deepseek.com](https://platform.deepseek.com/api_keys)      |
| `gpt-4o`                     | GPT-4o            | OpenAI    | [platform.openai.com](https://platform.openai.com/api-keys)          |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet | Anthropic | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

---

## 快速配置（以 DeepSeek 为例）

### 1. 复制环境变量模板

```bash
cp backend/.env.example backend/.env
```

### 2. 填写 API Key

编辑 `backend/.env`，将 `DEEPSEEK_API_KEY=` 后面填入你的 Key：

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

其他提供商的 Key 留空即可，不会影响系统运行。

### 3. 启动后端并验证

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

访问 [http://localhost:8000/docs](http://localhost:8000/docs)，在 `/api/v1/models` 接口（需先调 `/auth/login` 获取 token）可以确认 DeepSeek 已出现在模型列表中。

---

## 同时配置多个提供商

在 `backend/.env` 中填写多个 Key，系统会把所有已配置的模型都暴露给前端：

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

**默认模型**：模型列表中第一个被标记为默认模型，优先级顺序为：DeepSeek → OpenAI → Anthropic（按 `ai_service.py` 中 `AVAILABLE_MODELS` 的声明顺序）。

---

## 各提供商账号注册

### DeepSeek（推荐入门）

1. 注册：[platform.deepseek.com](https://platform.deepseek.com)
2. 左侧菜单 → **API Keys** → **Create new secret key**
3. 复制 `sk-` 开头的 Key 填入 `DEEPSEEK_API_KEY`

> DeepSeek V3 性价比极高，新用户有免费额度，适合开发测试。

### OpenAI

1. 注册：[platform.openai.com](https://platform.openai.com)
2. 右上角头像 → **API keys** → **Create new secret key**
3. 复制 `sk-proj-` 开头的 Key 填入 `OPENAI_API_KEY`

> 需绑定付款方式（信用卡）才能使用 GPT-4o。

### Anthropic (Claude)

1. 注册：[console.anthropic.com](https://console.anthropic.com)
2. **Settings** → **API Keys** → **Create Key**
3. 复制 `sk-ant-` 开头的 Key 填入 `ANTHROPIC_API_KEY`

---

## 新增模型

如需添加其他模型（如 `deepseek-reasoner`、`gpt-4o-mini` 等），编辑 `backend/app/services/ai_service.py`：

### 步骤一：在 `PROVIDER_CONFIG` 中添加路由

```python
PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    # 已有条目...
    "deepseek-reasoner": {
        "provider": "deepseek",
        "base_url": "https://api.deepseek.com",
    },
}
```

### 步骤二：在 `AVAILABLE_MODELS` 中添加元数据

```python
AVAILABLE_MODELS = [
    # 已有条目...
    {
        "id": "deepseek-reasoner",
        "name": "DeepSeek R1",
        "provider": "deepseek",
        "description": "DeepSeek 推理增强模型",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 64000,
        "is_default": False,
    },
]
```

只要 `provider` 与 `API_KEYS` 中的 key 匹配，且对应 Key 已填写，模型就会自动出现在前端列表中。

---

## 常见问题

**Q: 填了 Key 但前端看不到模型**

检查：

1. `backend/.env` 中 Key 已填写且无前后空格
2. 后端已重启（环境变量在启动时读取，修改后需重启）
3. Key 是否有效（在提供商控制台确认账户余额 / 配额）

**Q: 调用时报 `401 Unauthorized` 或 `402`**

- `401`：Key 填错或已失效，在对应平台重新生成
- `402`：账户余额不足，需充值

**Q: 想关闭某个模型，但不删 Key**

暂不支持单独禁用某个模型，临时方案是将 Key 置空（`OPENAI_API_KEY=`）后重启后端。

**Q: 流式输出（打字机效果）没有效果**

确认请求到达的是 `POST /api/v1/chat/stream` 而非 `/chat/completions`，前者才是 SSE 流式接口。
