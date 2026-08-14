"""语音转写 HTTP 合同测试。"""

from unittest.mock import AsyncMock

from httpx import AsyncClient

from app.api.v1 import voice


async def test_voice_transcription_requires_auth(client: AsyncClient) -> None:
    """语音内容必须只能由登录用户提交。"""
    response = await client.post(
        "/api/v1/voice/transcriptions",
        files={"file": ("voice.webm", b"audio", "audio/webm")},
    )

    assert response.status_code == 401


async def test_voice_transcription_returns_camel_case_payload(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """成功响应必须对三端统一使用 camelCase。"""
    monkeypatch.setattr(
        voice.voice_service,
        "transcribe_upload",
        AsyncMock(
            return_value=voice.voice_service.VoiceTranscription(
                text="测试语音", language="zh", duration_seconds=1.2
            )
        ),
    )

    response = await client.post(
        "/api/v1/voice/transcriptions",
        headers=auth_headers,
        files={"file": ("voice.webm", b"audio", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "测试语音",
        "language": "zh",
        "durationSeconds": 1.2,
    }


async def test_voice_transcription_hides_provider_error_text(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """下游异常不能将 provider 原始报错返回给客户端。"""
    monkeypatch.setattr(
        voice.voice_service,
        "transcribe_upload",
        AsyncMock(side_effect=voice.ai_service.VoiceTranscriptionProviderError()),
    )

    response = await client.post(
        "/api/v1/voice/transcriptions",
        headers=auth_headers,
        files={"file": ("voice.webm", b"audio", "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "VOICE_TRANSCRIPTION_FAILED"
    assert "secret upstream body" not in response.text
