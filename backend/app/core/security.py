from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return str(
        jwt.encode(
            {"sub": subject, "exp": expire, "type": "access"},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
    )


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(
        days=settings.refresh_token_expire_days
    )
    return str(
        jwt.encode(
            {"sub": subject, "exp": expire, "type": "refresh"},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
    )


def decode_token(token: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError as e:
        raise ValueError("Invalid token") from e
    return payload
