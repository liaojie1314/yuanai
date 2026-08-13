from fastapi.testclient import TestClient

from app.main import app


def test_desktop_custom_protocol_is_an_explicit_cors_origin() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "yuanai-app://renderer",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.headers["access-control-allow-origin"] == "yuanai-app://renderer"


def test_loopback_web_origin_is_allowed_by_cors() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


def test_unknown_custom_protocol_is_not_allowed_by_cors() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "yuanai-app://attacker",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert "access-control-allow-origin" not in response.headers
