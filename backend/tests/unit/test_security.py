"""security.py 单元测试 — 纯函数，不依赖数据库。"""

import os

import pytest

# 单元测试需要 jwt_secret_key，设置环境变量后再导入
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

from app.core.security import (  # noqa: E402
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password() -> None:
    plain = "MySecurePass1"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed)
    assert not verify_password("wrong-password", hashed)


def test_create_and_decode_access_token() -> None:
    subject = "user-123"
    token = create_access_token(subject)
    payload = decode_token(token)
    assert payload["sub"] == subject
    assert payload["type"] == "access"
    assert isinstance(payload["session_issued_at"], float)


def test_create_and_decode_refresh_token() -> None:
    subject = "user-456"
    token = create_refresh_token(subject)
    payload = decode_token(token)
    assert payload["sub"] == subject
    assert payload["type"] == "refresh"


def test_invalid_token_raises() -> None:
    with pytest.raises(ValueError, match="Invalid token"):
        decode_token("this-is-not-a-valid-jwt")
