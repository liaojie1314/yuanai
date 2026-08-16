from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # App
    app_name: str = "yuanai API"
    debug: bool = False

    # Database
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # S3
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_name: str = "yuanai-files"
    s3_public_url: str = "http://localhost:9000/yuanai-files"

    # Storage backend — "s3" (default, uses MinIO/AWS S3) or "local" (dev / tests)
    storage_backend: str = "s3"

    # 本地文件存储（storage_backend=local 时使用）
    local_uploads_dir: str = "./uploads"
    local_uploads_base_url: str = "http://localhost:8000/uploads"

    # 单个文件大小上限（分片上传合计），默认 500 MB
    max_upload_size_bytes: int = 500 * 1024 * 1024
    # 直传阈值（超过则必须走分片），默认 10 MB
    max_direct_upload_bytes: int = 10 * 1024 * 1024
    # 分片大小（S3 多段上传要求 ≥ 5 MB，最后一片可小于）
    upload_chunk_size_bytes: int = 5 * 1024 * 1024

    # AI Providers
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    deepseek_api_key: str = ""
    # Agnes AI key，使用 AGNES_API_KEY 环境变量注入，不提交到仓库
    agnes_api_key: str = ""
    # AssemblyAI 语音转写 key，使用 ASSEMBLYAI_API_KEY 环境变量注入，不提交到仓库
    assemblyai_api_key: str = ""
    # 视觉模型以内联 data URL 接收图片，避免云端模型无法访问内网对象存储 URL。
    ai_inline_image_max_bytes: int = 10 * 1024 * 1024

    # 语音转写：限制短音频，避免单个请求长期占用模型与解码资源。
    voice_max_upload_bytes: int = 25 * 1024 * 1024
    voice_max_duration_seconds: int = 300
    voice_transcription_timeout_seconds: int = 60
    voice_transcription_poll_interval_seconds: float = 1.0
    voice_ffprobe_path: str = "ffprobe"

    # 图片/视频生成：任务 worker 持久化 provider 输出后才向客户端公开对象存储地址。
    media_prompt_max_chars: int = 4_000
    media_worker_poll_interval_seconds: float = 1.0
    media_worker_lease_seconds: int = 60
    media_image_timeout_seconds: int = 90
    media_video_poll_timeout_seconds: int = 20
    media_video_poll_interval_seconds: float = 5.0
    media_video_max_poll_failures: int = 5
    media_max_output_bytes: int = 50 * 1024 * 1024
    media_ffmpeg_path: str = "ffmpeg"
    media_video_poster_timeout_seconds: int = 12
    media_video_poster_max_bytes: int = 2 * 1024 * 1024

    # 扫码登录：二维码只携带短时挑战和 API 地址，凭据始终由服务端哈希保存。
    qr_login_ttl_seconds: int = 90
    qr_login_poll_after_ms: int = 1000
    qr_login_api_base_url: str = "http://localhost:8000/api/v1"
    qr_login_create_limit: int = 15
    qr_login_attempt_limit: int = 12
    qr_login_rate_limit_window_seconds: int = 300

    # ── Email / SMTP (用于发送邮箱验证码) ─────────────────────────────
    # QQ 邮箱：smtp.qq.com / 465 (SSL) 或 587 (STARTTLS)
    # 授权码在 QQ 邮箱设置→账户→POP3/IMAP/SMTP 服务里生成（16 位字符串），不是登录密码
    smtp_host: str = "smtp.qq.com"
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "元AI"
    # 验证码有效期（秒）与发送节流间隔（秒）
    verify_code_ttl_seconds: int = 600
    verify_code_send_interval_seconds: int = 60
    # 测试环境后门：非空时跳过真实发送和 Redis 校验，任何 6 位数字都视作正确
    verify_code_debug_bypass: str = ""

    # ── 三方登录 / OAuth ──────────────────────────────────────
    # GitHub OAuth App：在 GitHub Settings → Developer settings → OAuth Apps 创建
    # Client Secret 泄漏后立即在 GitHub 页面 revoke，切勿写入代码库
    github_client_id: str = ""
    github_client_secret: str = ""
    # 后端回调 URL；必须与 GitHub OAuth App 中「Authorization callback URL」完全一致
    github_redirect_uri: str = "http://localhost:8000/api/v1/auth/github/callback"
    # Google OAuth 2.0 Client：在 Google Cloud Console → API 和服务 → 凭据 创建「OAuth 客户端 ID」
    # 授权重定向 URI 必须与 google_redirect_uri 完全一致
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    # 前端回调页面；后端 exchange 完 code 后把 access/refresh token 通过 302 拼在 URL 中
    web_app_url: str = "http://localhost:3000"

    # ── Web Push 推送（VAPID）─────────────────────────────────
    # 用 `uv run python -m py_vapid` 或 pywebpush 生成密钥对；私钥切勿提交代码库
    # 未配置时后端推送链路自动降级为 no-op（前端也不会发起订阅）
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    # VAPID subject：mailto: 或站点 URL，推送服务用它联系发送方
    vapid_subject: str = "mailto:admin@yuanai.example"


settings = Settings()  # type: ignore[call-arg]
