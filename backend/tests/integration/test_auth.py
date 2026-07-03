"""认证流程集成测试 — 注册/登录/刷新/登出/用户信息。

FastAPI HTTPException 错误格式：{"detail": {"code": ..., "message": ...}}
无 token 时 HTTPBearer 返回 401（FastAPI 0.115+）。
"""

from httpx import AsyncClient

from app.models.user import User


# 测试环境统一使用 conftest 里注入的 debug bypass 值作为验证码
VALID_CODE = "888888"


class TestRegister:
    async def test_register_success(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "new@example.com",
                "password": "NewPass1!",
                "username": "newuser",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "new@example.com"
        assert data["user"]["username"] == "newuser"

    async def test_register_missing_verify_code(self, client: AsyncClient) -> None:
        """未带验证码字段 → 422 (schema validation)"""
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": "vc@example.com", "password": "Test1234!", "username": "vcuser"},
        )
        assert response.status_code == 422

    async def test_register_wrong_verify_code(self, client: AsyncClient) -> None:
        """验证码不匹配 → 400 VERIFY_CODE_INVALID"""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "wrong@example.com",
                "password": "Test1234!",
                "username": "wronguser",
                "verifyCode": "111111",
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "VERIFY_CODE_INVALID"

    async def test_register_verify_code_wrong_format(self, client: AsyncClient) -> None:
        """验证码非 6 位数字 → 422 (schema validation)"""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "fmt@example.com",
                "password": "Test1234!",
                "username": "fmtuser",
                "verifyCode": "abcdef",
            },
        )
        assert response.status_code == 422

    async def test_register_duplicate_email(self, client: AsyncClient, test_user: User) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": test_user.email,
                "password": "Test1234!",
                "username": "otherusername",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "EMAIL_OR_USERNAME_EXISTS"

    async def test_register_duplicate_username(self, client: AsyncClient, test_user: User) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "other@example.com",
                "password": "Test1234!",
                "username": test_user.username,
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 409

    async def test_register_weak_password_no_digits(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "weak@example.com",
                "password": "onlyletters",
                "username": "weakuser",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 422

    async def test_register_password_too_short(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "short@example.com",
                "password": "Ab1!",
                "username": "shortuser",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 422

    async def test_register_invalid_email(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "not-an-email",
                "password": "Test1234!",
                "username": "baduser",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 422

    async def test_register_invalid_username(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "valid@example.com",
                "password": "Test1234!",
                "username": "a",
                "verifyCode": VALID_CODE,
            },
        )
        assert response.status_code == 422


class TestSendVerifyCode:
    async def test_send_code_success(self, client: AsyncClient) -> None:
        """register 场景下，未注册邮箱可以正常请求验证码"""
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": "fresh@example.com", "scene": "register"},
        )
        assert response.status_code == 200
        assert "已发送" in response.json()["message"]

    async def test_send_code_email_already_registered(
        self, client: AsyncClient, test_user: User
    ) -> None:
        """register 场景：已注册邮箱 409，避免枚举 + 骚扰"""
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": test_user.email, "scene": "register"},
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "EMAIL_ALREADY_REGISTERED"

    async def test_send_code_reset_password_requires_existing_email(
        self, client: AsyncClient, test_user: User
    ) -> None:
        """reset_password 场景：已注册邮箱可以发验证码"""
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": test_user.email, "scene": "reset_password"},
        )
        assert response.status_code == 200

    async def test_send_code_reset_password_email_not_found(self, client: AsyncClient) -> None:
        """reset_password 场景：未注册邮箱 404，避免给未注册地址发信"""
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": "unknown@example.com", "scene": "reset_password"},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "EMAIL_NOT_FOUND"

    async def test_send_code_invalid_email(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": "not-an-email", "scene": "register"},
        )
        assert response.status_code == 422

    async def test_send_code_invalid_scene(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/send-verify-code",
            json={"email": "ok@example.com", "scene": "unknown"},
        )
        assert response.status_code == 422


class TestResetPassword:
    async def test_reset_password_success(
        self, client: AsyncClient, test_user: User
    ) -> None:
        """正确邮箱 + 正确验证码 + 合法新密码 → 200，用新密码可以登录"""
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": test_user.email,
                "verifyCode": VALID_CODE,
                "newPassword": "BrandNew99!",
            },
        )
        assert response.status_code == 200
        assert "已重置" in response.json()["message"]

        # 用新密码登录成功
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "BrandNew99!"},
        )
        assert login_res.status_code == 200

        # 旧密码不再可用
        old_login = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "Test1234!"},
        )
        assert old_login.status_code == 401

    async def test_reset_password_email_not_found(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": "ghost@example.com",
                "verifyCode": VALID_CODE,
                "newPassword": "GhostNew99!",
            },
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "EMAIL_NOT_FOUND"

    async def test_reset_password_wrong_code(
        self, client: AsyncClient, test_user: User
    ) -> None:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": test_user.email,
                "verifyCode": "111111",
                "newPassword": "BrandNew99!",
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "VERIFY_CODE_INVALID"

    async def test_reset_password_weak_new_password(
        self, client: AsyncClient, test_user: User
    ) -> None:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": test_user.email,
                "verifyCode": VALID_CODE,
                "newPassword": "weakpw",
            },
        )
        assert response.status_code == 422

    async def test_reset_password_verify_code_wrong_format(
        self, client: AsyncClient, test_user: User
    ) -> None:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "email": test_user.email,
                "verifyCode": "abc",
                "newPassword": "BrandNew99!",
            },
        )
        assert response.status_code == 422


class TestLogin:
    async def test_login_success(self, client: AsyncClient, test_user: User) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "Test1234!"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user"]["email"] == test_user.email

    async def test_login_wrong_password(self, client: AsyncClient, test_user: User) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "WrongPass1!"},
        )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "AUTH_INVALID_CREDENTIALS"

    async def test_login_nonexistent_user(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "notexist@example.com", "password": "Test1234!"},
        )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "AUTH_INVALID_CREDENTIALS"

    async def test_login_invalid_email_format(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "bad-email", "password": "Test1234!"},
        )
        assert response.status_code == 422


class TestProtectedRoutes:
    async def test_get_me_without_token(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/me")
        # FastAPI 0.115+ HTTPBearer 无凭证返回 401
        assert response.status_code in (401, 403)

    async def test_get_me_with_invalid_token(self, client: AsyncClient) -> None:
        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401

    async def test_get_me_with_valid_token(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ) -> None:
        response = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user.email
        assert data["username"] == test_user.username

    async def test_update_me(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me",
            json={"username": "updatedname"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["username"] == "updatedname"

    async def test_logout(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post("/api/v1/auth/logout", headers=auth_headers)
        assert response.status_code == 200
        assert "已退出" in response.json()["message"]


class TestUserSettings:
    async def test_get_stats_unauthenticated(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/me/stats")
        assert response.status_code in (401, 403)

    async def test_get_stats_returns_zeros_for_new_user(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/api/v1/auth/me/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["conversationCount"] == 0
        assert data["totalTokens"] == 0
        assert data["fileCount"] == 0

    async def test_change_password_success(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/password",
            json={"old_password": "Test1234!", "new_password": "NewPass99!"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert "密码" in response.json()["message"]

    async def test_change_password_wrong_old_password(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/password",
            json={"old_password": "WrongOld1!", "new_password": "NewPass99!"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "OLD_PASSWORD_WRONG"

    async def test_change_password_weak_new_password(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/api/v1/auth/me/password",
            json={"old_password": "Test1234!", "new_password": "weakpw"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_change_password_unauthenticated(self, client: AsyncClient) -> None:
        response = await client.patch(
            "/api/v1/auth/me/password",
            json={"old_password": "Test1234!", "new_password": "NewPass99!"},
        )
        assert response.status_code in (401, 403)

    async def test_delete_me_success(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.delete("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert "注销" in response.json()["message"]

    async def test_delete_me_account_no_longer_accessible(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.delete("/api/v1/auth/me", headers=auth_headers)
        # Same token should fail to access /me after deletion
        response = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 401

    async def test_delete_me_unauthenticated(self, client: AsyncClient) -> None:
        response = await client.delete("/api/v1/auth/me")
        assert response.status_code in (401, 403)
