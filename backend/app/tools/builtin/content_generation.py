"""受控云端产出工具：图片 OCR 与 DOCX/XLSX/PPTX 文档生成。

OCR 直接复用知识入库用的 RapidOCR 适配层，不另写一份引擎封装；
文档生成只产出待持久化的字节内容，落盘与 Artifact 登记仍由 Tool Runtime 负责。
"""

from __future__ import annotations

import base64
import io
import re
import uuid

from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Pt
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.models.file import File
from app.services.knowledge_ocr import OcrUnavailableError, resolve_ocr_backend
from app.services.knowledge_parse import UnsupportedDocumentError, parse_document
from app.services.storage_service import storage
from app.tools.contracts import (
    SideEffect,
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

# 识别结果会整体回传模型上下文，必须低于 ToolSpec.max_output_bytes 并留出摘要余量
MAX_OCR_CHARS = 20_000
# 单次生成的文档条目数上限；再大的表格应当分多次生成，而不是一次塞进一个 Artifact
MAX_DOCUMENT_BLOCKS = 500
# 单个单元格/段落/幻灯片标题的字符上限
MAX_BLOCK_CHARS = 5_000
# 文件名会被当作 Artifact 名称使用，只接受单一路径片段
_UNSAFE_NAME_PATTERN = re.compile(r"[/\\\x00]")

_IMAGE_MIME_PREFIX = "image/"

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

_IMAGE_OCR_SPEC = ToolSpec(
    name="image_ocr",
    description=(
        "对当前用户已上传的图片做本地离线 OCR 并返回识别的纯文本；"
        "OCR 引擎未安装时返回 degraded 状态而不是报错。"
    ),
    input_schema={
        "type": "object",
        "properties": {"file_id": {"type": "string", "minLength": 1, "maxLength": 36}},
        "required": ["file_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "file_id": {"type": "string"},
            "status": {"type": "string"},
            "text": {"type": "string"},
            "truncated": {"type": "boolean"},
        },
    },
    risk_level=ToolRisk.read,
    execution_location="cloud",
    timeout_seconds=60,
    max_output_bytes=48 * 1024,
    required_scopes={"files.read"},
    tags={"files", "ocr", "image"},
)

_DOCX_WRITE_SPEC = ToolSpec(
    name="docx_write",
    description="在工作区生成一个 DOCX 文档 Artifact；段落与标题由参数给定，不写入用户磁盘。",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 255},
            "title": {"type": "string", "maxLength": MAX_BLOCK_CHARS},
            "blocks": {
                "type": "array",
                "maxItems": MAX_DOCUMENT_BLOCKS,
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string", "maxLength": MAX_BLOCK_CHARS},
                        "text": {"type": "string", "maxLength": MAX_BLOCK_CHARS},
                        "level": {"type": "integer", "minimum": 1, "maximum": 6},
                    },
                    "additionalProperties": False,
                },
            },
        },
        "required": ["name", "blocks"],
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    risk_level=ToolRisk.local_write,
    execution_location="cloud",
    timeout_seconds=30,
    side_effect=SideEffect.local_write,
    required_scopes={"workspace.write"},
    tags={"files", "artifact", "docx"},
)

_XLSX_WRITE_SPEC = ToolSpec(
    name="xlsx_write",
    description="在工作区生成一个 XLSX 表格 Artifact；按工作表名与二维行数据写入，不写入用户磁盘。",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 255},
            "sheets": {
                "type": "array",
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": {
                        "sheet_name": {"type": "string", "minLength": 1, "maxLength": 31},
                        "rows": {
                            "type": "array",
                            "maxItems": MAX_DOCUMENT_BLOCKS,
                            "items": {
                                "type": "array",
                                "maxItems": 100,
                                "items": {
                                    "type": ["string", "number", "boolean"],
                                    "maxLength": MAX_BLOCK_CHARS,
                                },
                            },
                        },
                    },
                    "required": ["sheet_name", "rows"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["name", "sheets"],
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    risk_level=ToolRisk.local_write,
    execution_location="cloud",
    timeout_seconds=30,
    side_effect=SideEffect.local_write,
    required_scopes={"workspace.write"},
    tags={"files", "artifact", "xlsx"},
)

_PPTX_WRITE_SPEC = ToolSpec(
    name="pptx_write",
    description=(
        "在工作区生成一个 PPTX 演示文稿 Artifact；每页标题与要点由参数给定，不写入用户磁盘。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 255},
            "slides": {
                "type": "array",
                "maxItems": 100,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "maxLength": MAX_BLOCK_CHARS},
                        "bullets": {
                            "type": "array",
                            "maxItems": 30,
                            "items": {"type": "string", "maxLength": MAX_BLOCK_CHARS},
                        },
                    },
                    "required": ["title"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["name", "slides"],
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    risk_level=ToolRisk.local_write,
    execution_location="cloud",
    timeout_seconds=30,
    side_effect=SideEffect.local_write,
    required_scopes={"workspace.write"},
    tags={"files", "artifact", "pptx"},
)


def _document_filename(name: str, suffix: str) -> str:
    """把模型给出的名称约束成单个文件名片段，路径分隔符与穿越一律拒绝。

    真正落到存储 key 前还会经过 Tool Runtime 的 ``_safe_name``，这里先挡一次是为了
    在工具边界就给出稳定错误，而不是生成一个名字被悄悄改写的 Artifact。
    """

    normalized = name.strip()
    if not normalized or _UNSAFE_NAME_PATTERN.search(normalized) or normalized in {".", ".."}:
        raise ToolError(ToolErrorCode.INVALID_INPUT, "INVALID_ARTIFACT_NAME")
    if normalized.lower().endswith(suffix):
        return normalized
    stem = normalized[: 255 - len(suffix)].rstrip(".")
    if not stem:
        raise ToolError(ToolErrorCode.INVALID_INPUT, "INVALID_ARTIFACT_NAME")
    return f"{stem}{suffix}"


def _workspace_document(name: str, payload: bytes, mime_type: str) -> dict[str, object]:
    """返回待持久化的二进制文档内容，由 Tool Runtime 解码后登记 Artifact。"""

    return {
        "name": name,
        "content_base64": base64.b64encode(payload).decode("ascii"),
        "mime_type": mime_type,
        "workspace": True,
    }


def _cell_value(value: object) -> str | int | float | bool:
    """保留单元格的原生类型；数字写成字符串会让表格里的求和与排序失效。"""

    if isinstance(value, bool | int | float):
        return value
    if value is None:
        return ""
    return str(value)[:MAX_BLOCK_CHARS]


def build_docx(*, title: str, blocks: list[dict[str, object]]) -> bytes:
    """按标题与段落构造 DOCX 字节流。"""

    document = Document()
    if title:
        document.add_heading(title, level=0)
    for block in blocks:
        heading = block.get("heading")
        if isinstance(heading, str) and heading.strip():
            level = block.get("level")
            heading_level = level if isinstance(level, int) and 1 <= level <= 6 else 1
            document.add_heading(heading.strip()[:MAX_BLOCK_CHARS], level=heading_level)
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            document.add_paragraph(text[:MAX_BLOCK_CHARS])
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def build_xlsx(*, sheets: list[dict[str, object]]) -> bytes:
    """按工作表与行数据构造 XLSX 字节流。"""

    workbook = Workbook()
    # Workbook 自带一个空工作表，第一张表复用它以免留下多余空页
    default_sheet = workbook.active
    for index, sheet in enumerate(sheets):
        sheet_name = str(sheet.get("sheet_name", ""))[:31] or f"Sheet{index + 1}"
        worksheet = default_sheet if index == 0 else workbook.create_sheet()
        worksheet.title = sheet_name
        rows = sheet.get("rows")
        if not isinstance(rows, list):
            continue
        for row in rows[:MAX_DOCUMENT_BLOCKS]:
            if not isinstance(row, list):
                continue
            worksheet.append([_cell_value(cell) for cell in row[:100]])
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def build_pptx(*, slides: list[dict[str, object]]) -> bytes:
    """按标题与要点构造 PPTX 字节流；没有幻灯片时也要能打开。"""

    presentation = Presentation()
    layout = presentation.slide_layouts[1]
    if not slides:
        # python-pptx 允许零页演示文稿，但多数阅读器打不开；给一页空标题页更稳妥
        presentation.slides.add_slide(presentation.slide_layouts[0])
    for slide in slides[:100]:
        created = presentation.slides.add_slide(layout)
        title_placeholder = created.shapes.title
        if title_placeholder is not None:
            title_placeholder.text = str(slide.get("title", ""))[:MAX_BLOCK_CHARS]
        body = next(
            (shape for shape in created.placeholders if shape.placeholder_format.idx == 1), None
        )
        if body is None:
            continue
        bullets = slide.get("bullets")
        if not isinstance(bullets, list):
            continue
        frame = body.text_frame
        for offset, bullet in enumerate(bullets[:30]):
            paragraph = frame.paragraphs[0] if offset == 0 else frame.add_paragraph()
            paragraph.text = str(bullet)[:MAX_BLOCK_CHARS]
            paragraph.font.size = Pt(18)
    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


async def image_ocr(arguments: dict[str, object], context: ToolContext) -> ToolOutput:
    """读取当前租户上传的图片并做离线 OCR，引擎缺失时返回降级状态。"""

    if context.db is None or context.user_id is None:
        raise ToolError(ToolErrorCode.FILE_CONTEXT_REQUIRED)
    try:
        file_id = uuid.UUID(str(arguments.get("file_id")))
    except (AttributeError, ValueError) as error:
        raise ToolError(ToolErrorCode.FILE_NOT_FOUND) from error
    try:
        file = await context.db.scalar(
            select(File).where(File.id == file_id, File.user_id == context.user_id)
        )
        if file is None:
            raise ToolError(ToolErrorCode.FILE_NOT_FOUND)
        if not file.mime_type.startswith(_IMAGE_MIME_PREFIX):
            raise ToolError(ToolErrorCode.INVALID_INPUT, "FILE_NOT_AN_IMAGE")
        data = await storage.get_object(file.s3_key)
    except ToolError:
        raise
    except (OSError, KeyError, SQLAlchemyError, ValueError) as error:
        raise ToolError(ToolErrorCode.EXECUTION_FAILED) from error

    ocr = resolve_ocr_backend()
    if ocr is None:
        # 与知识入库一致：引擎缺失是可识别的降级状态，不是工具执行失败
        return {
            "file_id": str(file.id),
            "filename": file.filename,
            "status": "degraded",
            "text": "",
            "char_count": 0,
            "truncated": False,
        }
    try:
        parsed = parse_document(data, file.mime_type, file.filename, ocr=ocr)
    except UnsupportedDocumentError as error:
        raise ToolError(ToolErrorCode.EXECUTION_FAILED, str(error)) from error
    except (OcrUnavailableError, OSError, RuntimeError, ValueError) as error:
        raise ToolError(ToolErrorCode.EXECUTION_FAILED, "OCR_FAILED") from error
    text = "\n".join(block.content for block in parsed.blocks)
    truncated = len(text) > MAX_OCR_CHARS
    return {
        "file_id": str(file.id),
        "filename": file.filename,
        "status": "degraded" if parsed.ocr_missing else "succeeded",
        "text": text[:MAX_OCR_CHARS],
        "char_count": min(len(text), MAX_OCR_CHARS),
        "truncated": truncated,
    }


async def docx_write(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """生成 DOCX 字节流并交给 Tool Runtime 登记 Artifact。"""

    name = _document_filename(str(arguments.get("name", "")), ".docx")
    blocks = arguments.get("blocks")
    if not isinstance(blocks, list):
        raise ToolError(ToolErrorCode.INVALID_INPUT)
    title = arguments.get("title")
    payload = build_docx(
        title=title if isinstance(title, str) else "",
        blocks=[block for block in blocks if isinstance(block, dict)],
    )
    return _workspace_document(name, payload, _DOCX_MIME)


async def xlsx_write(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """生成 XLSX 字节流并交给 Tool Runtime 登记 Artifact。"""

    name = _document_filename(str(arguments.get("name", "")), ".xlsx")
    sheets = arguments.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        raise ToolError(ToolErrorCode.INVALID_INPUT)
    payload = build_xlsx(sheets=[sheet for sheet in sheets if isinstance(sheet, dict)])
    return _workspace_document(name, payload, _XLSX_MIME)


async def pptx_write(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """生成 PPTX 字节流并交给 Tool Runtime 登记 Artifact。"""

    name = _document_filename(str(arguments.get("name", "")), ".pptx")
    slides = arguments.get("slides")
    if not isinstance(slides, list):
        raise ToolError(ToolErrorCode.INVALID_INPUT)
    payload = build_pptx(slides=[slide for slide in slides if isinstance(slide, dict)])
    return _workspace_document(name, payload, _PPTX_MIME)


PHASE6_WAVE2_BUILTINS = (
    (_IMAGE_OCR_SPEC, image_ocr),
    (_DOCX_WRITE_SPEC, docx_write),
    (_XLSX_WRITE_SPEC, xlsx_write),
    (_PPTX_WRITE_SPEC, pptx_write),
)

__all__ = [
    "MAX_OCR_CHARS",
    "PHASE6_WAVE2_BUILTINS",
    "build_docx",
    "build_pptx",
    "build_xlsx",
    "docx_write",
    "image_ocr",
    "pptx_write",
    "xlsx_write",
]
