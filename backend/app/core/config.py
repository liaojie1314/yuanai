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


settings = Settings()  # type: ignore[call-arg]
