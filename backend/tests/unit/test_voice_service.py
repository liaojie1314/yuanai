"""语音转写服务的边界与错误映射测试。"""

from unittest.mock import AsyncMock

import pytest

from app.services import voice_service


@pytest.fixture(autouse=True)
def reset_voice_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    """每个用例使用小且可预测的上传限制。"""
    monkeypatch.setattr(voice_service.settings, "voice_max_upload_bytes", 1024)
    monkeypatch.setattr(voice_service.settings, "voice_max_duration_seconds", 300)


async def test_transcribe_upload_returns_text_and_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """合法音频应交给 AI 服务并保留测得时长。"""
    monkeypatch.setattr(voice_service, "probe_duration_seconds", AsyncMock(return_value=2.4))
    monkeypatch.setattr(
        voice_service.ai_service,
        "transcribe_audio",
        AsyncMock(return_value="  你好，元AI  "),
    )

    result = await voice_service.transcribe_upload(
        filename="voice.webm", content=b"audio", mime_type="audio/webm"
    )

    assert result.text == "你好，元AI"
    assert result.language is None
    assert result.duration_seconds == 2.4


async def test_transcribe_upload_rejects_unsupported_mime_type() -> None:
    """文本文件不得被误送入语音模型。"""
    with pytest.raises(voice_service.VoiceUnsupportedMediaTypeError):
        await voice_service.transcribe_upload(
            filename="note.txt", content=b"not audio", mime_type="text/plain"
        )


async def test_transcribe_upload_rejects_oversized_audio() -> None:
    """超出大小上限必须在写临时文件和调用模型前拒绝。"""
    with pytest.raises(voice_service.VoiceFileTooLargeError):
        await voice_service.transcribe_upload(
            filename="voice.webm", content=b"x" * 1025, mime_type="audio/webm"
        )


async def test_transcribe_upload_rejects_audio_over_duration_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """超过最大时长的音频不得消耗 Whisper 配额。"""
    monkeypatch.setattr(voice_service, "probe_duration_seconds", AsyncMock(return_value=300.01))

    with pytest.raises(voice_service.VoiceAudioTooLongError):
        await voice_service.transcribe_upload(
            filename="voice.webm", content=b"audio", mime_type="audio/webm"
        )


async def test_probe_duration_falls_back_to_audio_packet_timestamps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """浏览器 WebM 缺少容器时长元数据时，仍应从 packet 时间戳得到时长。"""
    monkeypatch.setattr(
        voice_service,
        "_run_ffprobe",
        AsyncMock(side_effect=[b"N/A\n", b"0.000000,0.020000\n1.980000,0.020000\n"]),
    )

    duration = await voice_service.probe_duration_seconds(b"audio", "voice.webm")

    assert duration == 2.0


async def test_transcribe_upload_maps_unreadable_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """无法读取容器时长时应返回稳定领域错误。"""
    monkeypatch.setattr(
        voice_service,
        "probe_duration_seconds",
        AsyncMock(side_effect=voice_service.VoiceDurationUnreadableError()),
    )

    with pytest.raises(voice_service.VoiceDurationUnreadableError):
        await voice_service.transcribe_upload(
            filename="voice.webm", content=b"audio", mime_type="audio/webm"
        )


async def test_transcribe_upload_propagates_provider_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """服务层不泄露或替换 ai_service 的稳定 provider 错误类型。"""
    monkeypatch.setattr(voice_service, "probe_duration_seconds", AsyncMock(return_value=1.0))
    monkeypatch.setattr(
        voice_service.ai_service,
        "transcribe_audio",
        AsyncMock(side_effect=voice_service.ai_service.VoiceTranscriptionTimeoutError()),
    )

    with pytest.raises(voice_service.ai_service.VoiceTranscriptionTimeoutError):
        await voice_service.transcribe_upload(
            filename="voice.webm", content=b"audio", mime_type="audio/webm"
        )
