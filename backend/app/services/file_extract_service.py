"""有界文件解析，用于预览和发送给模型的上下文。"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass

from docx import Document
from docx.opc.exceptions import OpcError
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pypdf import PdfReader
from pypdf.errors import PyPdfError

MAX_EXTRACTED_CHARS = 50_000
TEXT_TYPES = {"text/plain", "text/markdown", "application/json", "text/csv"}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@dataclass(frozen=True)
class Preview:
    kind: str
    text: str | None = None
    rows: list[list[str]] | None = None
    supported: bool = True


def _limit(value: str) -> str:
    return value[:MAX_EXTRACTED_CHARS]


def extract_preview(data: bytes, mime_type: str, filename: str) -> Preview:
    """解析支持的文件，所有输出均限制为 50,000 个字符。"""
    if mime_type in IMAGE_TYPES:
        return Preview(kind="image")
    if mime_type in TEXT_TYPES or filename.lower().endswith((".txt", ".md", ".json", ".csv")):
        text = data.decode("utf-8", errors="replace")
        if mime_type == "application/json" or filename.lower().endswith(".json"):
            try:
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                pass
        if mime_type == "text/csv" or filename.lower().endswith(".csv"):
            csv_rows = [list(row) for row in csv.reader(io.StringIO(text))][:1000]
            return Preview(kind="table", rows=csv_rows)
        return Preview(kind="text", text=_limit(text))
    if mime_type == "application/pdf" or filename.lower().endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except PyPdfError:
            return Preview(kind="unsupported", supported=False)
        return Preview(kind="pdf", text=_limit(text))
    if mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    } or filename.lower().endswith(".docx"):
        try:
            document = Document(io.BytesIO(data))
            text = "\n".join(p.text for p in document.paragraphs)
        except (KeyError, OpcError, ValueError):
            return Preview(kind="unsupported", supported=False)
        return Preview(kind="text", text=_limit(text))
    if mime_type in {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    } or filename.lower().endswith(".xlsx"):
        try:
            workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except (InvalidFileException, KeyError, OSError, ValueError):
            return Preview(kind="unsupported", supported=False)
        rows: list[list[str]] = []
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(values_only=True):
                rows.append(["" if cell is None else str(cell) for cell in row])
                if len(rows) >= 1000:
                    break
            if len(rows) >= 1000:
                break
        return Preview(kind="table", rows=rows)
    return Preview(kind="unsupported", supported=False)


def preview_context(preview: Preview) -> str:
    """把预览转换为注入模型上下文的纯文本。"""
    if preview.kind in {"text", "pdf"}:
        return preview.text or ""
    if preview.kind == "table":
        return "\n".join("\t".join(row) for row in (preview.rows or []))[:MAX_EXTRACTED_CHARS]
    return ""
