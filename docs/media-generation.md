# 媒体生成与音乐配置

## 能力范围

媒体生成沿用 `/api/v1/media/tasks` 任务接口和持久化消息时间线。当前支持：

| 类型 | 客户端                 | 输出     | 说明                                               |
| ---- | ---------------------- | -------- | -------------------------------------------------- |
| 图片 | Web / Mobile / Desktop | 图片     | 沿用既有图片任务能力                               |
| 视频 | Web / Mobile / Desktop | MP4 视频 | 沿用既有视频任务能力                               |
| 音乐 | Web / Mobile / Desktop | MP3 音频 | 纯音乐走 MusicGen；歌词歌曲走 ACE-Step，固定 30 秒 |

音乐生成是独立于 Phase 6 Tool Runtime 的媒体能力，不代表 MCP、云沙箱、Desktop
执行节点或浏览器自动化已经交付。当前支持纯音乐和歌词歌曲；两者都固定 30 秒，不支持
可选时长、分轨、波形或独立的人声控制。歌词歌曲必须使用本机 ACE-Step，ACE-Step 未启动
或生成失败时不会降级成无歌词纯音乐，避免用户歌词意图被静默丢失。纯音乐的远程 provider
失败时，会在开启配置且本机依赖和模型可用时降级到本机 MusicGen。

客户端只请求后端任务接口。后端 worker 通过
`backend/app/services/ai_service.py` 调用供应商，将结果复制到项目对象存储后才向客户端
返回结果 URL；供应商 URL、API Key 和原始错误响应不会进入客户端消息或日志。

## 默认方案：本机 MusicGen

默认使用本机 `facebook/musicgen-small`，不需要 Hugging Face Token，也不消耗远程 API
额度。后端 worker 会在第一次音乐任务时加载模型，后续任务复用进程内模型；同一进程内
音乐生成串行执行，避免同时占满显存。

本机配置：

```dotenv
MEDIA_MUSIC_PROVIDER=local
MEDIA_MUSIC_LOCAL_MODEL=facebook/musicgen-small
# auto 优先 CUDA；可选 cpu / cuda
MEDIA_MUSIC_LOCAL_DEVICE=auto
MEDIA_MUSIC_LOCAL_FILES_ONLY=true
MEDIA_MUSIC_LOCAL_MAX_NEW_TOKENS=1500
```

运行环境建议：

- NVIDIA GPU：优先使用 CUDA；本机 RTX 3050 4 GB 已实测可以生成约 30 秒 MP3。
- 没有 CUDA：将 `MEDIA_MUSIC_LOCAL_DEVICE` 设为 `cpu`，可以运行但会明显变慢。
- 默认只读取已缓存的 MusicGen 模型，避免生成任务因 Hugging Face 网络重试而长时间停在 0%。
- 首次下载模型时，将 `MEDIA_MUSIC_LOCAL_FILES_ONLY=false` 临时写入本地 `backend/.env`，并在启动命令中临时注入本机 `HTTP_PROXY` / `HTTPS_PROXY`；下载完成后恢复为 `true`。代理只用于本机预热缓存，不是项目配置。
- 首次安装会下载 PyTorch、Transformers 和 MusicGen 模型，磁盘空间不足时不要并发启动多个
  安装进程。项目依赖已经包含本机 provider 所需包，使用 `uv sync` 安装。

启动真实项目仍使用项目脚本：

```bash
pnpm check:runtime
pnpm dev:real
```

## 歌词歌曲：本机 ACE-Step

歌词模式复用 `/api/v1/media/tasks`，客户端只提交 `lyrics` 字段，后端不会把请求直接发给
第三方。请按 [ACE-Step 1.5 官方仓库](https://github.com/ace-step/ACE-Step-1.5) 准备本机
checkout、模型和 Python 依赖，然后在单独终端启动服务：

```bash
ACE_STEP_DIR=/absolute/path/to/ACE-Step-1.5 pnpm dev:ace-step
```

`ACE_STEP_DIR` 必须指向包含 `pyproject.toml` 的目录，服务默认监听 `127.0.0.1:8001`；
如需变更可临时设置 `ACE_STEP_HOST` 和 `ACE_STEP_PORT`。在 `backend/.env` 中确认
`ACE_STEP_BASE_URL`、`ACE_STEP_MODEL`、`ACE_STEP_TIMEOUT_SECONDS` 后重启后端。歌词任务会
保留排队/运行进度和已保存的 ACE-Step 任务 ID；服务短暂断连时有限重试，服务未启动时会
明确显示“歌词音乐服务未启动”，不会静默改成纯音乐。不要把本机目录或 `MEDIA_MUSIC_PROXY_URL`
写入项目配置。

### 设备与低显存配置

ACE-Step 的 2B DiT-only 路径官方标注最低 4 GB 显存，但实际可用空间还会受到 CUDA 上下文、
模型版本和驱动影响。建议使用至少 6 GB 可用显存；`<=4 GB` 的显卡不能把默认 REST 启动当作
稳定验收路径。当前本机 RTX 3050 4 GB 能加载低显存配置，但在实际推理时仍会因显存不足失败。

CPU-only 推理是官方支持的回退方式，已在本项目环境生成过有效的 30 秒、48 kHz、128 kbps
歌词 MP3。它会占用约 10 GB 内存并明显变慢，单曲约需数分钟，因此只应保持单任务运行，且不要
同时启动构建、模型下载或其他高内存进程：

```bash
ACESTEP_DEVICE=cpu \
ACESTEP_OFFLOAD_TO_CPU=true \
ACESTEP_OFFLOAD_DIT_TO_CPU=true \
ACESTEP_NO_INIT=false \
ACE_STEP_DIR=/absolute/path/to/ACE-Step-1.5 \
pnpm dev:ace-step
```

这些是启动 ACE-Step 的本机 shell 变量，不是 YuanAI 的 `backend/.env` 配置；不要把它们、
本机路径、Token 或代理地址提交到仓库。首次下载 ACE-Step 核心模型前应预留约 10 GB 磁盘空间；
模型已经缓存时不要清理其 `checkpoints` 目录。

## 可选方案：Hugging Face 远程推理

只有将 `MEDIA_MUSIC_PROVIDER` 显式设为 `huggingface` 时，后端才会优先调用远程推理路由。
当前 `facebook/musicgen-small` 在 Hugging Face Serverless Inference 中返回
`Model not supported by provider hf-inference`；官方 `facebook/MusicGen` Space 也可能排队
后返回 ZeroGPU 错误。因此远程方案只用于实验，不作为默认验收路径；远程失败后默认退回本机
MusicGen，避免限流或排队阻断生成。

如需测试远程方案，才需要配置 Token：

1. 注册或登录 [Hugging Face](https://huggingface.co/)。
2. 打开 [Settings → Access Tokens](https://huggingface.co/settings/tokens)，点击 `Create new token`。
3. **Token type 保持 `Fine-grained`**。
4. Token name 可以填写 `yuanai-music`。
5. 在 `Presets` 中选择 **`Inference`**。
6. `Applies to` 保持当前个人账号，不需要添加组织。
7. 不要选择 `Full Access`、`Write` 或只包含下载权限的 `Read-Only`。远程实验只需要调用公开模型进行推理。
8. 点击 `Create token`，Token 只会完整显示一次，立即保存到本机密码管理器。不要把 Token 写入 Git、截图、聊天记录或前端环境变量。

Hugging Face 的免费推理额度、模型排队和速率限制会随账号、区域和平台策略变化，不能承诺固定生成数量。远程适配器会等待并重试模型加载、`429`、`503`、网关错误和短暂网络故障，但远程模型本身不支持时不会无限重试。

## 本地配置

在仓库根目录执行：

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，只在后端配置 Key：

```dotenv
HF_TOKEN=你的HuggingFace_Token
MEDIA_MUSIC_PROVIDER=huggingface
HUGGINGFACE_MUSIC_MODEL=facebook/musicgen-small
HUGGINGFACE_MUSIC_BASE_URL=https://router.huggingface.co/hf-inference
MEDIA_MUSIC_MAX_ATTEMPTS=4
MEDIA_MUSIC_RETRY_DELAY_SECONDS=2
# 远程限流、排队超时或服务错误时退回本机 MusicGen
MEDIA_MUSIC_FALLBACK_TO_LOCAL=true
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

`pnpm dev:real` 会通过 Docker Compose 启动本地 PostgreSQL、Redis、MinIO、SearXNG，再启动
FastAPI 和 Web。它不会
把 Token 暴露给 Web、Mobile 或 Desktop；三端都通过 FastAPI 使用音乐生成能力。没有配置
`HF_TOKEN` 时，纯音乐的远程 provider 会先失败，若启用本机 fallback 且 MusicGen 可用则
自动降级；歌词模式不使用该 Token，而是要求 ACE-Step 服务可用。任何情况下都不会向客户端
泄漏 Token 或供应商响应正文。

如果当前网络访问 Hugging Face 远程 provider 需要本地代理，请在启动项目时通过标准环境变量注入，
不要把代理地址作为项目配置提交：

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 pnpm dev:real
```

端口必须替换为你本机代理实际监听的端口；不要把代理账号密码写入仓库。

## 使用与验证

1. 使用真实环境登录 Web、Desktop 或 Mobile。
2. 在聊天 composer 中切换到 Music，选择“纯音乐”或“歌词歌曲”。
3. 填写曲风描述；歌词歌曲还要填写歌词，然后提交固定 30 秒任务。
4. 任务完成后，在消息中的音频控件播放或下载 MP3；三端读取同一份后端持久化结果。
5. 刷新会话，确认任务状态和结果仍可恢复。

自动化验证：

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
cd backend && uv run pytest tests/unit -x -q
cd backend && uv run pytest tests/integration -x -q
```

本机 provider 可以在有 GPU 的环境直接做真实 30 秒生成验收；没有可用远程 Token 时，仍可
验证本机生成、错误脱敏、取消、重试和前端播放状态。

## 常见问题

### 前端看不到 Music 模式

确认 Web、Desktop 或 Mobile 使用的是包含音乐功能的当前版本，并重新启动对应客户端。
Music 模式只允许纯文本 prompt，图片/视频附件和图片视频专用选项会被禁用。纯音乐提示词
应描述乐器、节奏、氛围或编曲；歌词歌曲需要先启动 ACE-Step，再填写歌词和曲风描述。

### 任务提示 provider unavailable

默认本机 MusicGen 和 ACE-Step 都不需要 Hugging Face Token。若显式使用远程 provider，确认 `backend/.env` 中变量名完全是
`HF_TOKEN`，没有前后空格，并确认 Token 创建时选择了 `Fine-grained → Inference`。不要把
Token 放到 `apps/*/.env` 或 `NEXT_PUBLIC_*` 变量中。

### 任务失败或超时

本机纯音乐生成失败时检查 CUDA、显存和模型缓存；远程生成失败时系统会先按有限次数重试，
再退回本机 MusicGen。歌词任务失败时检查 ACE-Step 进程、8001 端口和模型日志，不会改成
纯音乐。出现任务已失败时，客户端会显示“音乐生成未完成”，不会继续伪装成进度查询故障。若日志
包含 CUDA OOM，使用上方 CPU-only 命令或迁移到显存更充足的设备。远程仍失败时再检查 Hugging
Face Token 权限、账号额度和模型状态。日志不会打印 Token 或供应商响应正文。
必要时可适当提高 `MEDIA_MUSIC_TIMEOUT_SECONDS`，但仍应保持有界超时；远程遇到排队或 `429`
时等待一段时间后重试，不要并发提交多个任务。

### 如何确认 Key 没有被提交

```bash
git check-ignore -v backend/.env
git status --short
```

只提交 `backend/.env.example` 中的空变量名，不提交 `backend/.env` 或任何真实 Key。
