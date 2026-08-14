"""语音转写 HTTP API。"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.api.deps import CurrentUser
from app.services import ai_service, voice_service

router = APIRouter(prefix="/voice", tags=["voice"])


class VoiceTranscriptionResponse(BaseModel):
    """三端共享的语音转写响应。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    text: str
    language: str | None
    duration_seconds: float


def _voice_http_exception(error: Exception) -> HTTPException:
    """将已知领域错误序列化为不含 provider 细节的稳定 HTTP 响应。"""
    if isinstance(error, voice_service.VoiceUnsupportedMediaTypeError):
        return HTTPException(
            415,
            {"code": "VOICE_UNSUPPORTED_MEDIA_TYPE", "message": "不支持的音频格式"},
        )
    if isinstance(error, voice_service.VoiceFileTooLargeError):
        return HTTPException(
            413,
            {"code": "VOICE_FILE_TOO_LARGE", "message": "音频文件超过大小上限"},
        )
    if isinstance(error, voice_service.VoiceEmptyAudioError):
        return HTTPException(422, {"code": "VOICE_EMPTY_AUDIO", "message": "未检测到可转写的音频"})
    if isinstance(error, voice_service.VoiceAudioTooLongError):
        return HTTPException(413, {"code": "VOICE_AUDIO_TOO_LONG", "message": "音频时长超过上限"})
    if isinstance(error, voice_service.VoiceDurationUnreadableError):
        return HTTPException(
            422,
            {"code": "VOICE_DURATION_UNREADABLE", "message": "无法读取音频时长"},
        )
    if isinstance(error, ai_service.VoiceTranscriptionUnavailableError):
        return HTTPException(
            503,
            {"code": "VOICE_TRANSCRIPTION_UNAVAILABLE", "message": "语音转写暂不可用"},
        )
    if isinstance(error, ai_service.VoiceTranscriptionTimeoutError):
        return HTTPException(
            504,
            {"code": "VOICE_TRANSCRIPTION_TIMEOUT", "message": "语音转写超时，请重试"},
        )
    return HTTPException(
        502,
        {"code": "VOICE_TRANSCRIPTION_FAILED", "message": "语音转写失败，请重试"},
    )


@router.post("/transcriptions", response_model=VoiceTranscriptionResponse)
async def create_transcription(
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> VoiceTranscriptionResponse:
    """接收登录用户的一段短音频并返回转写文本。"""
    del current_user
    content = await file.read()
    try:
        transcription = await voice_service.transcribe_upload(
            filename=file.filename or "voice",
            content=content,
            mime_type=file.content_type or "application/octet-stream",
        )
    except (
        ai_service.VoiceTranscriptionProviderError,
        ai_service.VoiceTranscriptionTimeoutError,
        ai_service.VoiceTranscriptionUnavailableError,
        voice_service.VoiceAudioTooLongError,
        voice_service.VoiceDurationUnreadableError,
        voice_service.VoiceEmptyAudioError,
        voice_service.VoiceFileTooLargeError,
        voice_service.VoiceUnsupportedMediaTypeError,
    ) as exc:
        raise _voice_http_exception(exc) from exc
    return VoiceTranscriptionResponse(
        text=transcription.text,
        language=transcription.language,
        duration_seconds=transcription.duration_seconds,
    )
