"""多格式结构感知解析：把上传文件拆成带章节定位的结构块。

切块前先还原文档结构（Markdown/HTML 标题、PDF 页码、工作表区域、代码符号），
让每个片段都能带着可回到原文的 section 标签，而不是按固定字符数粗暴截断。
"""

from __future__ import annotations

import ast
import csv
import io
import json
import logging
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

from docx import Document
from docx.opc.exceptions import OpcError
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pypdf import PageObject, PdfReader
from pypdf.errors import PyPdfError

from app.services.knowledge_ocr import OcrBackend

logger = logging.getLogger(__name__)

MAX_PARSED_CHARS = 200_000
ROWS_PER_BLOCK = 50

_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(\S.*)$")
_DOCX_HEADING_PATTERN = re.compile(r"(?:Heading|标题)\s*(\d)")
_HTML_SKIP_TAGS = frozenset({"script", "style", "noscript", "template"})
_HTML_BLOCK_TAGS = frozenset(
    {"p", "div", "li", "tr", "br", "section", "article", "blockquote", "pre", "td", "th"}
)
_TEXT_SUFFIXES = (".txt", ".md", ".markdown")
_HTML_SUFFIXES = (".html", ".htm")
_CODE_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".sql", ".sh")
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class UnsupportedDocumentError(Exception):
    """文件类型不在支持的解析范围内，或内容损坏到无法解析。"""


@dataclass(frozen=True)
class ParsedBlock:
    """一个结构块：section 为标题路径、页码或工作表区域，可为空。"""

    section: str | None
    content: str


@dataclass(frozen=True)
class ParsedDocument:
    """一次解析的产物与 OCR 使用情况。"""

    parser: str
    blocks: list[ParsedBlock] = field(default_factory=list)
    ocr_used: bool = False
    ocr_missing: bool = False


def parse_document(
    data: bytes, mime_type: str, filename: str, *, ocr: OcrBackend | None = None
) -> ParsedDocument:
    """按 MIME 与扩展名选择解析器，返回结构块与 OCR 使用情况。

    `ocr` 为 None 表示 OCR 后端不可用：需要 OCR 的内容不会抛错，而是让返回值的
    `ocr_missing` 为真，由调用方标记降级状态。
    """

    lowered = filename.lower()
    if mime_type.startswith("image/"):
        return _parse_image(data, ocr)
    if mime_type == "application/pdf" or lowered.endswith(".pdf"):
        return _parse_pdf(data, ocr)
    if mime_type == _DOCX_MIME or lowered.endswith(".docx"):
        return _truncate(ParsedDocument("docx", _parse_markdown(_docx_markdown(data))))
    if mime_type == _XLSX_MIME or lowered.endswith(".xlsx"):
        return _truncate(ParsedDocument("xlsx", _parse_xlsx(data)))
    if mime_type == "text/csv" or lowered.endswith(".csv"):
        rows = [list(row) for row in csv.reader(io.StringIO(_decode(data)))]
        return _truncate(ParsedDocument("csv", _rows_to_blocks(rows, "表格")))
    if mime_type == "text/html" or lowered.endswith(_HTML_SUFFIXES):
        return _truncate(ParsedDocument("html", _parse_markdown(_html_markdown(_decode(data)))))
    if mime_type == "application/json" or lowered.endswith(".json"):
        return _truncate(ParsedDocument("json", _parse_markdown(_pretty_json(_decode(data)))))
    if lowered.endswith(".py"):
        return _truncate(ParsedDocument("python", _parse_python(_decode(data), filename)))
    if lowered.endswith(_CODE_SUFFIXES):
        return _truncate(ParsedDocument("code", [ParsedBlock(filename, _decode(data))]))
    if mime_type.startswith("text/") or lowered.endswith(_TEXT_SUFFIXES):
        return _truncate(ParsedDocument("markdown", _parse_markdown(_decode(data))))
    raise UnsupportedDocumentError(f"不支持的文件类型: {mime_type or filename}")


def _decode(data: bytes) -> str:
    """按 UTF-8 解码，非法字节保留为替换字符交给质量检查判定乱码。"""

    return data.decode("utf-8", errors="replace")


def _pretty_json(text: str) -> str:
    """格式化 JSON 以便按层级切块；非法 JSON 原样入库。"""

    try:
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except json.JSONDecodeError as error:
        logger.warning("JSON 解析失败，按纯文本入库: %s", error)
        return text


def _parse_markdown(text: str) -> list[ParsedBlock]:
    """按 Markdown 标题层级切分，section 记录完整标题路径。"""

    blocks: list[ParsedBlock] = []
    headings: list[str] = []
    buffer: list[str] = []

    def flush() -> None:
        content = "\n".join(buffer).strip()
        buffer.clear()
        if content:
            blocks.append(ParsedBlock(" > ".join(headings) or None, content))

    for line in text.splitlines():
        match = _HEADING_PATTERN.match(line)
        if match is None:
            buffer.append(line)
            continue
        flush()
        del headings[len(match.group(1)) - 1 :]
        headings.append(match.group(2).strip())
    flush()
    return blocks


def _parse_pdf(data: bytes, ocr: OcrBackend | None) -> ParsedDocument:
    """逐页解析 PDF 并保留页码；无文字层的页面走 OCR。"""

    try:
        reader = PdfReader(io.BytesIO(data))
    except PyPdfError as error:
        raise UnsupportedDocumentError(f"PDF 解析失败: {error}") from error
    blocks: list[ParsedBlock] = []
    ocr_used = False
    ocr_missing = False
    for number, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except PyPdfError as error:
            logger.warning("PDF 第 %d 页文字提取失败: %s", number, error)
            text = ""
        if not text.strip():
            images = _page_images(page, number)
            if images and ocr is None:
                ocr_missing = True
            elif images:
                text = "\n".join(ocr(image) for image in images if ocr is not None)
                ocr_used = ocr_used or bool(text.strip())
        if text.strip():
            blocks.append(ParsedBlock(f"第 {number} 页", text))
    return _truncate(ParsedDocument("pdf", blocks, ocr_used=ocr_used, ocr_missing=ocr_missing))


def _page_images(page: PageObject, number: int) -> list[bytes]:
    """取出页面内嵌图片；损坏的 XObject 不应让整份文档失败。"""

    try:
        return [image.data for image in page.images]
    except Exception as error:  # pypdf 对异常 XObject 会抛多种底层异常
        logger.warning("PDF 第 %d 页内嵌图片读取失败: %s", number, error)
        return []


def _parse_image(data: bytes, ocr: OcrBackend | None) -> ParsedDocument:
    """图片只有 OCR 一条路径，后端缺失时返回空结果并标记降级。"""

    if ocr is None:
        return ParsedDocument("image", [], ocr_missing=True)
    text = ocr(data)
    blocks = [ParsedBlock(None, text)] if text.strip() else []
    return _truncate(ParsedDocument("image", blocks, ocr_used=True))


def _docx_markdown(data: bytes) -> str:
    """把 docx 段落还原成带标题层级的 Markdown 文本。"""

    try:
        document = Document(io.BytesIO(data))
    except (KeyError, OpcError, ValueError) as error:
        raise UnsupportedDocumentError(f"docx 解析失败: {error}") from error
    lines: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style is not None else ""
        match = _DOCX_HEADING_PATTERN.search(style_name or "")
        if match is None:
            lines.append(text)
        else:
            lines.append("#" * min(int(match.group(1)), 6) + f" {text}")
    return "\n\n".join(lines)


def _parse_xlsx(data: bytes) -> list[ParsedBlock]:
    """按工作表与行区域切块，不跨表混合内容。"""

    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (InvalidFileException, KeyError, OSError, ValueError) as error:
        raise UnsupportedDocumentError(f"xlsx 解析失败: {error}") from error
    blocks: list[ParsedBlock] = []
    for sheet in workbook.worksheets:
        rows = [
            ["" if cell is None else str(cell) for cell in row]
            for row in sheet.iter_rows(values_only=True)
        ]
        blocks.extend(_rows_to_blocks(rows, f"工作表 {sheet.title}"))
    workbook.close()
    return blocks


def _rows_to_blocks(rows: list[list[str]], label: str) -> list[ParsedBlock]:
    """把表格行按固定区域分组，section 记录行范围便于回到原表。"""

    blocks: list[ParsedBlock] = []
    for offset in range(0, len(rows), ROWS_PER_BLOCK):
        group = rows[offset : offset + ROWS_PER_BLOCK]
        content = "\n".join("\t".join(row) for row in group).strip()
        if content:
            blocks.append(ParsedBlock(f"{label} 第 {offset + 1}-{offset + len(group)} 行", content))
    return blocks


def _parse_python(text: str, filename: str) -> list[ParsedBlock]:
    """用 AST 按顶层符号切分 Python 源码，section 为 文件::符号。"""

    try:
        tree = ast.parse(text)
    except SyntaxError as error:
        logger.warning("Python AST 解析失败，按纯文本入库: %s", error)
        return [ParsedBlock(filename, text)]
    blocks: list[ParsedBlock] = []
    covered: set[int] = set()
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            continue
        start = min([node.lineno, *(item.lineno for item in node.decorator_list)])
        covered.update(range(start, (node.end_lineno or node.lineno) + 1))
        segment = ast.get_source_segment(text, node)
        if segment:
            blocks.append(ParsedBlock(f"{filename}::{node.name}", segment))
    remainder = "\n".join(
        line for number, line in enumerate(text.splitlines(), start=1) if number not in covered
    ).strip()
    if remainder:
        blocks.insert(0, ParsedBlock(filename, remainder))
    return blocks


def _html_markdown(text: str) -> str:
    """剥离标签并把 h1-h6 还原为 Markdown 标题。"""

    parser = _HtmlToMarkdown()
    parser.feed(text)
    parser.close()
    return "\n\n".join(parser.lines)


def _truncate(parsed: ParsedDocument) -> ParsedDocument:
    """限制单次入库的总字符数，超出部分丢弃而非截断成半个片段。"""

    kept: list[ParsedBlock] = []
    remaining = MAX_PARSED_CHARS
    for block in parsed.blocks:
        if remaining <= 0:
            logger.warning("解析内容超过 %d 字符上限，已丢弃超出的结构块", MAX_PARSED_CHARS)
            break
        kept.append(ParsedBlock(block.section, block.content[:remaining]))
        remaining -= len(kept[-1].content)
    return ParsedDocument(
        parser=parsed.parser,
        blocks=kept,
        ocr_used=parsed.ocr_used,
        ocr_missing=parsed.ocr_missing,
    )


class _HtmlToMarkdown(HTMLParser):
    """把 HTML 压平成带 Markdown 标题的文本行，忽略脚本与样式内容。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self._heading_level = 0
        self._skip_depth = 0
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """块级标签与标题开始处切断当前文本行。"""

        if tag in _HTML_SKIP_TAGS:
            self._skip_depth += 1
            return
        level = _heading_level(tag)
        if level or tag in _HTML_BLOCK_TAGS:
            self._flush()
            self._heading_level = level

    def handle_endtag(self, tag: str) -> None:
        """块级标签结束处同样切断文本行。"""

        if tag in _HTML_SKIP_TAGS:
            self._skip_depth = max(self._skip_depth - 1, 0)
            return
        if _heading_level(tag) or tag in _HTML_BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        """收集可见文本，脚本/样式区域内的内容直接丢弃。"""

        if self._skip_depth == 0:
            self._buffer.append(data)

    def _flush(self) -> None:
        """输出一行，标题按层级加上 Markdown 前缀。"""

        text = " ".join("".join(self._buffer).split())
        self._buffer.clear()
        level = self._heading_level
        self._heading_level = 0
        if text:
            self.lines.append(f"{'#' * level} {text}" if level else text)


def _heading_level(tag: str) -> int:
    """返回 h1-h6 的层级，其他标签为 0。"""

    if len(tag) == 2 and tag[0] == "h" and tag[1] in "123456":
        return int(tag[1])
    return 0
