"""Pydantic schema 校验逻辑单元测试。"""

import os

import pytest
from pydantic import ValidationError

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test"
)
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

from app.schemas.auth import RegisterRequest  # noqa: E402

# 单元测试中固定使用一个 6 位数字作为验证码占位；实际校验发生在 auth_service.register
_VC = "123456"


class TestRegisterRequest:
    def test_valid_request(self) -> None:
        req = RegisterRequest(
            email="user@example.com", password="Test1234!", username="testuser", verify_code=_VC
        )
        assert req.email == "user@example.com"

    def test_password_too_short(self) -> None:
        with pytest.raises(ValidationError, match="至少 8 位"):
            RegisterRequest(email="u@e.com", password="Ab1", username="user", verify_code=_VC)

    def test_password_no_digit(self) -> None:
        with pytest.raises(ValidationError, match="字母和数字"):
            RegisterRequest(
                email="u@e.com", password="onlyletters", username="user", verify_code=_VC
            )

    def test_password_no_letter(self) -> None:
        with pytest.raises(ValidationError, match="字母和数字"):
            RegisterRequest(email="u@e.com", password="12345678", username="user", verify_code=_VC)

    def test_username_too_short(self) -> None:
        with pytest.raises(ValidationError):
            RegisterRequest(email="u@e.com", password="Test1234!", username="a", verify_code=_VC)

    def test_username_too_long(self) -> None:
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="u@e.com", password="Test1234!", username="a" * 21, verify_code=_VC
            )

    def test_username_with_chinese(self) -> None:
        req = RegisterRequest(
            email="u@e.com", password="Test1234!", username="用户名", verify_code=_VC
        )
        assert req.username == "用户名"

    def test_invalid_email(self) -> None:
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="not-an-email", password="Test1234!", username="user", verify_code=_VC
            )

    def test_verify_code_must_be_6_digits(self) -> None:
        with pytest.raises(ValidationError, match="6 位数字"):
            RegisterRequest(
                email="u@e.com", password="Test1234!", username="user", verify_code="12345"
            )

    def test_verify_code_rejects_non_digit(self) -> None:
        with pytest.raises(ValidationError, match="6 位数字"):
            RegisterRequest(
                email="u@e.com", password="Test1234!", username="user", verify_code="abcdef"
            )
