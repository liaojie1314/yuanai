"""受限语音转写服务：在模型调用前验证音频的类型、大小与时长。"""

import asyncio
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.services import ai_service

SUPPORTED_AUDIO_MIME_TYPES = frozenset(
    {
        "audio/aac",
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/x-m4a",
    }
)


class VoiceUnsupportedMediaTypeError(ValueError):
    """上传文件不属于语音转写允许的容器类型。"""


class VoiceFileTooLargeError(ValueError):
    """上传文件超过语音转写字节上限。"""


class VoiceEmptyAudioError(ValueError):
    """录音没有任何可转写字节。"""


class VoiceAudioTooLongError(ValueError):
    """音频时长超过语音转写上限。"""


class VoiceDurationUnreadableError(ValueError):
    """无法安全读取音频容器的时长。"""


@dataclass(frozen=True)
class VoiceTranscription:
    """经过边界验证后的转写结果。"""

    text: str
    language: str | None
    duration_seconds: float


def _normalize_mime_type(mime_type: str) -> str:
    """移除上传 Content-Type 的参数并统一大小写。"""
    return mime_type.split(";", 1)[0].strip().lower()


def _suffix_from_filename(filename: str) -> str:
    """为 ffprobe 临时文件保留安全且有限的容器扩展名。"""
    suffix = Path(filename).suffix.lower()
    return suffix if suffix in {".aac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm"} else ".bin"


def _write_temp_file(path: str, content: bytes) -> None:
    """在线程中写入短生命周期的音频文件。"""
    Path(path).write_bytes(content)


def _parse_positive_duration(stdout: bytes) -> float | None:
    """解析 ffprobe 的单个时长值，缺失或非正值时返回空。"""
    try:
        duration_seconds = float(stdout.decode("utf-8").strip())
    except (UnicodeDecodeError, ValueError):
        return None
    return duration_seconds if math.isfinite(duration_seconds) and duration_seconds > 0 else None


def _parse_packet_duration(stdout: bytes) -> float | None:
    """根据音频 packet 的时间戳计算不含容器 duration 元数据的录音时长。"""
    try:
        lines = stdout.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return None

    end_time = 0.0
    for line in lines:
        parts = line.split(",")
        try:
            presentation_time = float(parts[0])
        except (IndexError, ValueError):
            continue
        try:
            packet_duration = float(parts[1])
        except (IndexError, ValueError):
            packet_duration = 0.0
        candidate = presentation_time + max(packet_duration, 0.0)
        if math.isfinite(candidate):
            end_time = max(end_time, candidate)
    return end_time if end_time > 0 else None


async def _run_ffprobe(temp_path: str, entries: str, output_format: str) -> bytes:
    """对应用创建的临时音频执行受限的 ffprobe 查询。"""
    process = await asyncio.create_subprocess_exec(
        settings.voice_ffprobe_path,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        entries,
        "-of",
        output_format,
        temp_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await process.communicate()
    if process.returncode != 0:
        raise VoiceDurationUnreadableError()
    return stdout


async def probe_duration_seconds(content: bytes, filename: str) -> float:
    """通过 ffprobe 读取音频时长，支持缺少容器时长元数据的浏览器录音。

    ffprobe 只接收应用创建的临时路径；原始文件名仅用于限定白名单扩展名，
    不能影响命令参数结构。
    """
    descriptor, temp_path = tempfile.mkstemp(
        prefix="yuanai-voice-",
        suffix=_suffix_from_filename(filename),
    )
    os.close(descriptor)
    try:
        await asyncio.to_thread(_write_temp_file, temp_path, content)
        try:
            async with asyncio.timeout(5):
                format_duration = _parse_positive_duration(
                    await _run_ffprobe(
                        temp_path,
                        "format=duration",
                        "default=noprint_wrappers=1:nokey=1",
                    )
                )
                if format_duration is not None:
                    return format_duration
                packet_duration = _parse_packet_duration(
                    await _run_ffprobe(
                        temp_path,
                        "packet=pts_time,duration_time",
                        "csv=p=0",
                    )
                )
        except (OSError, TimeoutError) as exc:
            raise VoiceDurationUnreadableError() from exc

        if packet_duration is None:
            raise VoiceDurationUnreadableError()
        return packet_duration
    finally:
        await asyncio.to_thread(Path(temp_path).unlink, missing_ok=True)


async def transcribe_upload(*, filename: str, content: bytes, mime_type: str) -> VoiceTranscription:
    """验证上传的短音频并通过统一 AI 服务生成转写文本。"""
    normalized_mime_type = _normalize_mime_type(mime_type)
    if normalized_mime_type not in SUPPORTED_AUDIO_MIME_TYPES:
        raise VoiceUnsupportedMediaTypeError()
    if not content:
        raise VoiceEmptyAudioError()
    if len(content) > settings.voice_max_upload_bytes:
        raise VoiceFileTooLargeError()

    duration_seconds = await probe_duration_seconds(content, filename)
    if duration_seconds > settings.voice_max_duration_seconds:
        raise VoiceAudioTooLongError()
    text = await ai_service.transcribe_audio(
        filename=filename,
        content=content,
        mime_type=normalized_mime_type,
    )
    normalized_text = text.strip()
    if not normalized_text:
        raise ai_service.VoiceTranscriptionProviderError()
    return VoiceTranscription(
        text=normalized_text,
        language=None,
        duration_seconds=duration_seconds,
    )
