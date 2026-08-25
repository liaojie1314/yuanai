# 媒体生成与音乐配置

## 能力范围

媒体生成沿用 `/api/v1/media/tasks` 任务接口和持久化消息时间线。当前支持：

| 类型 | 客户端                 | 输出     | 说明                                 |
| ---- | ---------------------- | -------- | ------------------------------------ |
| 图片 | Web / Mobile / Desktop | 图片     | 沿用既有图片任务能力                 |
| 视频 | Web / Mobile / Desktop | MP4 视频 | 沿用既有视频任务能力                 |
| 音乐 | Web / Mobile / Desktop | MP3 音频 | ElevenLabs Music，固定 30 秒、纯音乐 |

音乐生成是独立于 Phase 6 Tool Runtime 的媒体能力，不代表 MCP、云沙箱、Desktop
执行节点或浏览器自动化已经交付。首版暂不支持歌词、演唱、人声控制、可选时长、分轨、
波形或供应商自动 fallback。

客户端只请求后端任务接口。后端 worker 通过
`backend/app/services/ai_service.py` 调用供应商，将结果复制到项目对象存储后才向客户端
返回结果 URL；供应商 URL、API Key 和原始错误响应不会进入客户端消息或日志。

## 获取 ElevenLabs API Key

1. 注册或登录 [ElevenLabs](https://elevenlabs.io/)。
2. 打开官方 [API Keys 页面](https://elevenlabs.io/app/developers/api-keys)。如果页面要求重新登录，先完成登录。
3. 创建一个 API Key，复制后立即保存到本机密码管理器。不要把 Key 写入 Git、截图、聊天记录或前端环境变量。
4. 根据账户的套餐和余额确认 Music API 可用额度。套餐、免费额度和计费规则可能变化，以 [ElevenLabs Pricing](https://elevenlabs.io/pricing) 页面为准；本项目不把免费额度当作长期保证。

## 本地配置

在仓库根目录执行：

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，只在后端配置 Key：

```dotenv
ELEVENLABS_API_KEY=你的ElevenLabs_API_Key
```

可选的音乐 worker 超时默认是 120 秒：

```dotenv
MEDIA_MUSIC_TIMEOUT_SECONDS=120
```

修改 `backend/.env` 后必须重启后端。推荐使用项目脚本启动真实环境：

```bash
pnpm check:runtime
pnpm dev:real
```

`pnpm dev:real` 会启动本地 PostgreSQL、Redis、MinIO、SearXNG、FastAPI 和 Web。它不会
把 Key 暴露给 Web、Mobile 或 Desktop；三端都通过 FastAPI 使用音乐生成能力。没有配置
`ELEVENLABS_API_KEY` 时，音乐任务会进入 provider unavailable/失败状态，不会向客户端
泄漏 Key 或供应商响应正文。

## 使用与验证

1. 使用真实环境登录 Web、Desktop 或 Mobile。
2. 在聊天 composer 中切换到 Music，输入纯音乐提示词并提交。
3. 任务完成后，在消息中的音频控件播放或下载 MP3；三端读取同一份后端持久化结果。
4. 刷新会话，确认任务状态和结果仍可恢复。

自动化验证：

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
cd backend && uv run pytest tests/unit -x -q
cd backend && uv run pytest tests/integration -x -q
```

没有可用 Key 时可以验证 provider unavailable、错误脱敏、取消、重试和前端播放状态；
这不能替代真实 ElevenLabs 生成验收。真实生成验收必须在不打印 Key 的前提下，使用已配置
额度的本地环境执行一次 30 秒任务。

## 常见问题

### 前端看不到 Music 模式

确认 Web、Desktop 或 Mobile 使用的是包含音乐功能的当前版本，并重新启动对应客户端。
Music 模式只允许纯文本 prompt，图片/视频附件和图片视频专用选项会被禁用。

### 任务提示 provider unavailable

确认 `backend/.env` 中变量名完全是 `ELEVENLABS_API_KEY`，没有前后空格，并重启后端。
不要把 Key 放到 `apps/*/.env` 或 `NEXT_PUBLIC_*` 变量中。

### 任务失败或超时

检查 ElevenLabs 控制台中的 Key 状态、套餐额度和 Music API 权限，再检查后端日志中的
稳定错误码。日志不会打印 Key 或供应商响应正文。必要时可适当提高
`MEDIA_MUSIC_TIMEOUT_SECONDS`，但仍应保持有界超时。

### 如何确认 Key 没有被提交

```bash
git check-ignore -v backend/.env
git status --short
```

只提交 `backend/.env.example` 中的空变量名，不提交 `backend/.env` 或任何真实 Key。
