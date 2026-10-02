"""可选的本地离线 OCR 后端（RapidOCR），缺失时降级而不是让入库失败。"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)

# 识别一张图片的字节流并返回纯文本，没有文字时返回空串
OcrBackend = Callable[[bytes], str]

_MODULE_NAME = "rapidocr_onnxruntime"


class OcrUnavailableError(RuntimeError):
    """未安装 OCR 可选依赖，或引擎初始化失败。"""


def load_ocr_backend() -> OcrBackend:
    """加载 RapidOCR 并返回识别函数，未安装时抛 OcrUnavailableError。

    RapidOCR 是 `pip install yuanai-backend[ocr]` 才带的可选依赖，因此导入与引擎
    构造都放在调用时，避免未安装该 extra 的部署在启动阶段就炸。
    """

    try:
        module = importlib.import_module(_MODULE_NAME)
    except ImportError as error:  # 包含 ModuleNotFoundError 与 onnxruntime 缺失
        raise OcrUnavailableError(f"{_MODULE_NAME} 未安装") from error
    try:
        engine = module.RapidOCR()
    except Exception as error:  # 模型权重缺失或下载失败都不该把入库整体打断
        raise OcrUnavailableError(f"{_MODULE_NAME} 引擎初始化失败: {error}") from error

    def recognize(image: bytes) -> str:
        """逐行返回图片中识别出的文字。"""

        result, _ = engine(image)
        return "\n".join(str(line[1]) for line in result or () if len(line) > 1)

    return recognize


def resolve_ocr_backend() -> OcrBackend | None:
    """返回可用的 OCR 后端；不可用时记一条明确 warning 并返回 None。"""

    try:
        return load_ocr_backend()
    except OcrUnavailableError as error:
        logger.warning("OCR 不可用，扫描件与图片将按降级处理: %s", error)
        return None
