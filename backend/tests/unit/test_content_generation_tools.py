"""M11 Wave 2 工具契约：图片 OCR、DOCX/XLSX/PPTX 生成与剪贴板占位。

生成类工具的核心断言是「产出的字节能被重新打开读回原文」——只断言没报错，
会让一个产出空文档的实现照样通过。
"""

from __future__ import annotations

import base64
import io
import uuid
from unittest.mock import AsyncMock

import pytest
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File
from app.services import storage_service
from app.tools.builtin.content_generation import (
    MAX_OCR_CHARS,
    PHASE6_WAVE2_BUILTINS,
    _document_filename,
    build_docx,
    build_pptx,
    build_xlsx,
    docx_write,
    image_ocr,
    pptx_write,
    xlsx_write,
)
from app.tools.builtin.desktop import (
    DESKTOP_BUILTINS,
    READ_CLIPBOARD_SPEC,
    read_clipboard,
)
from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolRisk,
    ToolValidationError,
)
from app.tools.registry import validate_arguments_against_schema


def _spec(name: str) -> object:
    """按结果形状取出某个 Wave 2 工具的 spec。"""

    for spec, _handler in PHASE6_WAVE2_BUILTINS:
        if spec.name == name:
            return spec
    raise AssertionError(f"未注册的工具 {name}")


# ── 工具注册与风险等级 ────────────────────────────────────────────────────────


def test_wave2_tools_are_registered_once_each() -> None:
    """四个 Wave 2 工具各自只注册一次，且都在 cloud 执行。"""

    names = [spec.name for spec, _handler in PHASE6_WAVE2_BUILTINS]
    assert names == ["image_ocr", "docx_write", "xlsx_write", "pptx_write"]
    assert len(set(names)) == len(names)
    for spec, _handler in PHASE6_WAVE2_BUILTINS:
        assert spec.execution_location == "cloud"


def test_ocr_is_read_risk_and_generation_is_local_write() -> None:
    """OCR 只读；三个生成工具写工作区，风险等级必须高于 read。"""

    assert _spec("image_ocr").risk_level is ToolRisk.read  # type: ignore[attr-defined]
    for name in ("docx_write", "xlsx_write", "pptx_write"):
        assert _spec(name).risk_level is not ToolRisk.read  # type: ignore[attr-defined]


def test_generation_schemas_reject_unknown_arguments() -> None:
    """生成工具的参数 schema 必须拒绝多余字段，避免模型塞入未定义参数。"""

    with pytest.raises(ToolValidationError):
        validate_arguments_against_schema(
            {"name": "报告.docx", "blocks": [], "unexpected": 1},
            _spec("docx_write").input_schema,  # type: ignore[attr-defined]
        )


# ── 文件名与路径穿越 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "hostile",
    [
        "../../etc/passwd",
        "..\\..\\windows\\system32",
        "/etc/passwd",
        "notes/todo.docx",
        "a\x00b.docx",
        "..",
        "   ",
    ],
)
def test_document_filename_blocks_path_traversal(hostile: str) -> None:
    """文件名来自模型输出，是不可信输入；路径分隔符与穿越段一律拒绝。"""

    with pytest.raises(ToolError) as error:
        _document_filename(hostile, ".docx")
    assert error.value.code is ToolErrorCode.INVALID_INPUT


@pytest.mark.parametrize("suffix", [".docx", ".xlsx", ".pptx"])
def test_document_filename_normalizes_and_keeps_single_segment(suffix: str) -> None:
    """正常名称补齐后缀；已带后缀的不重复追加。"""

    assert _document_filename("测试报告", suffix) == f"测试报告{suffix}"
    assert _document_filename(f"测试报告{suffix}", suffix) == f"测试报告{suffix}"


@pytest.mark.asyncio
async def test_docx_write_rejects_traversal_name_before_building() -> None:
    """穿越名称必须在工具边界就被拒绝，而不是生成一个被悄悄改名的 Artifact。"""

    with pytest.raises(ToolError) as error:
        await docx_write({"name": "../../escape.docx", "blocks": []}, ToolContext())
    assert error.value.code is ToolErrorCode.INVALID_INPUT


# ── 生成内容可被重新读回 ──────────────────────────────────────────────────────


def test_generated_docx_reopens_with_headings_and_paragraphs() -> None:
    """生成的 DOCX 必须能重新打开，且标题与正文按写入顺序读回。"""

    payload = build_docx(
        title="测试文档1",
        blocks=[
            {"heading": "第一节", "text": "第一节正文。", "level": 1},
            {"text": "无标题段落。"},
        ],
    )

    document = Document(io.BytesIO(payload))
    texts = [paragraph.text for paragraph in document.paragraphs if paragraph.text]
    assert texts == ["测试文档1", "第一节", "第一节正文。", "无标题段落。"]
    # 标题必须是真正的 Heading 样式，而不是看起来像标题的普通段落
    styles = {paragraph.text: paragraph.style.name for paragraph in document.paragraphs}
    assert styles["第一节"] == "Heading 1"


def test_generated_xlsx_reopens_with_sheet_values_and_types() -> None:
    """生成的 XLSX 必须能重新打开，工作表名、行序与数值类型都要保留。"""

    payload = build_xlsx(
        sheets=[
            {"sheet_name": "汇总", "rows": [["项目", "数量"], ["测试项1", 3], ["测试项2", 5.5]]},
            {"sheet_name": "明细", "rows": [["备注", "说明"]]},
        ]
    )

    workbook = load_workbook(io.BytesIO(payload))
    assert workbook.sheetnames == ["汇总", "明细"]
    sheet = workbook["汇总"]
    assert [cell.value for cell in sheet[1]] == ["项目", "数量"]
    assert [cell.value for cell in sheet[2]] == ["测试项1", 3]
    assert [cell.value for cell in sheet[3]] == ["测试项2", 5.5]
    workbook.close()


def test_generated_xlsx_with_single_sheet_has_no_extra_blank_page() -> None:
    """Workbook 默认自带一张空表；单表生成时不能留下多余空工作表。"""

    payload = build_xlsx(sheets=[{"sheet_name": "唯一表", "rows": [["a"]]}])
    workbook = load_workbook(io.BytesIO(payload))
    assert workbook.sheetnames == ["唯一表"]
    workbook.close()


def test_generated_pptx_reopens_with_slide_titles_and_bullets() -> None:
    """生成的 PPTX 必须能重新打开，每页标题与要点逐条读回。"""

    payload = build_pptx(
        slides=[
            {"title": "封面标题", "bullets": ["要点一", "要点二"]},
            {"title": "第二页", "bullets": ["要点三"]},
        ]
    )

    presentation = Presentation(io.BytesIO(payload))
    assert len(presentation.slides) == 2
    titles = [slide.shapes.title.text for slide in presentation.slides]
    assert titles == ["封面标题", "第二页"]
    first_body = presentation.slides[0].placeholders[1].text_frame
    assert [paragraph.text for paragraph in first_body.paragraphs] == ["要点一", "要点二"]


def test_generated_pptx_without_slides_still_opens() -> None:
    """空幻灯片列表不能产出零页演示文稿，否则阅读器打不开。"""

    payload = build_pptx(slides=[])
    presentation = Presentation(io.BytesIO(payload))
    assert len(presentation.slides) == 1


# ── 生成工具返回的持久化契约 ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_docx_write_returns_base64_workspace_payload() -> None:
    """生成工具返回 base64 二进制并要求 Tool Runtime 登记为 Artifact。"""

    output = await docx_write(
        {"name": "测试文档2.docx", "blocks": [{"text": "正文。"}]}, ToolContext()
    )
    assert output["workspace"] is True
    assert output["name"] == "测试文档2.docx"
    assert output["mime_type"].endswith("wordprocessingml.document")
    payload = base64.b64decode(str(output["content_base64"]))
    assert "正文。" in "\n".join(
        paragraph.text for paragraph in Document(io.BytesIO(payload)).paragraphs
    )


@pytest.mark.asyncio
async def test_xlsx_write_requires_at_least_one_sheet() -> None:
    """没有工作表的表格没有意义，必须按参数错误拒绝而不是产出空文件。"""

    with pytest.raises(ToolError) as error:
        await xlsx_write({"name": "空表.xlsx", "sheets": []}, ToolContext())
    assert error.value.code is ToolErrorCode.INVALID_INPUT


@pytest.mark.asyncio
async def test_pptx_write_returns_base64_workspace_payload() -> None:
    """PPTX 同样走 base64 工作区载荷。"""

    output = await pptx_write(
        {"name": "演示", "slides": [{"title": "测试页", "bullets": ["要点"]}]}, ToolContext()
    )
    assert output["name"] == "演示.pptx"
    payload = base64.b64decode(str(output["content_base64"]))
    presentation = Presentation(io.BytesIO(payload))
    assert presentation.slides[0].shapes.title.text == "测试页"


# ── 图片 OCR ──────────────────────────────────────────────────────────────────


async def _create_image_file(db: AsyncSession, user_id: uuid.UUID) -> File:
    """登记一条指向假图片对象的 files 行。"""

    file = File(
        id=uuid.uuid4(),
        user_id=user_id,
        filename="扫描件1.png",
        mime_type="image/png",
        size_bytes=8,
        s3_key="files/scan-1.png",
    )
    db.add(file)
    await db.flush()
    return file


@pytest.mark.asyncio
async def test_image_ocr_uses_the_injected_backend(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OCR 工具必须走 knowledge_ocr 适配层，测试用假后端避免下载模型权重。"""

    file = await _create_image_file(db, test_user.id)
    monkeypatch.setattr(
        "app.tools.builtin.content_generation.resolve_ocr_backend",
        lambda: lambda _data: "识别出的第一行\n识别出的第二行",
    )
    monkeypatch.setattr(storage_service.storage, "get_object", AsyncMock(return_value=b"fake-png"))

    output = await image_ocr({"file_id": str(file.id)}, ToolContext(user_id=test_user.id, db=db))

    assert output["status"] == "succeeded"
    assert output["text"] == "识别出的第一行\n识别出的第二行"
    assert output["char_count"] == len("识别出的第一行\n识别出的第二行")
    assert output["truncated"] is False


@pytest.mark.asyncio
async def test_image_ocr_degrades_when_rapidocr_is_missing(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """未安装 RapidOCR 时必须返回可识别的降级状态，不能抛栈把工具执行打成失败。"""

    file = await _create_image_file(db, test_user.id)
    # resolve_ocr_backend 在引擎不可用时返回 None（记 warning，不抛）
    monkeypatch.setattr("app.tools.builtin.content_generation.resolve_ocr_backend", lambda: None)
    monkeypatch.setattr(storage_service.storage, "get_object", AsyncMock(return_value=b"fake-png"))

    output = await image_ocr({"file_id": str(file.id)}, ToolContext(user_id=test_user.id, db=db))

    assert output["status"] == "degraded"
    assert output["text"] == ""
    assert output["char_count"] == 0
    assert output["truncated"] is False


@pytest.mark.asyncio
async def test_image_ocr_truncates_long_recognition(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """识别结果超过上限时截断并置 truncated，避免撑爆模型上下文。"""

    file = await _create_image_file(db, test_user.id)
    monkeypatch.setattr(
        "app.tools.builtin.content_generation.resolve_ocr_backend",
        lambda: lambda _data: "字" * (MAX_OCR_CHARS + 50),
    )
    monkeypatch.setattr(storage_service.storage, "get_object", AsyncMock(return_value=b"fake-png"))

    output = await image_ocr({"file_id": str(file.id)}, ToolContext(user_id=test_user.id, db=db))

    assert output["truncated"] is True
    assert len(str(output["text"])) == MAX_OCR_CHARS


@pytest.mark.asyncio
async def test_image_ocr_rejects_another_tenants_file(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """跨租户的 file_id 必须当作不存在，不得读取对象存储。"""

    file = await _create_image_file(db, test_user.id)
    get_object = AsyncMock(return_value=b"fake-png")
    monkeypatch.setattr(storage_service.storage, "get_object", get_object)

    with pytest.raises(ToolError) as error:
        await image_ocr({"file_id": str(file.id)}, ToolContext(user_id=uuid.uuid4(), db=db))
    assert error.value.code is ToolErrorCode.FILE_NOT_FOUND
    get_object.assert_not_awaited()


@pytest.mark.asyncio
async def test_image_ocr_rejects_a_non_image_file(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OCR 只接受图片；PDF 等应走知识入库链路，不能静默按图片处理。"""

    file = File(
        id=uuid.uuid4(),
        user_id=test_user.id,
        filename="测试文档3.pdf",
        mime_type="application/pdf",
        size_bytes=8,
        s3_key="files/doc-3.pdf",
    )
    db.add(file)
    await db.flush()
    monkeypatch.setattr(
        "app.tools.builtin.content_generation.resolve_ocr_backend", lambda: lambda _data: "x"
    )

    with pytest.raises(ToolError) as error:
        await image_ocr({"file_id": str(file.id)}, ToolContext(user_id=test_user.id, db=db))
    assert error.value.code is ToolErrorCode.INVALID_INPUT


@pytest.mark.asyncio
async def test_image_ocr_requires_a_tenant_context() -> None:
    """没有租户上下文时必须 fail closed，不能退化成读取任意文件。"""

    with pytest.raises(ToolError) as error:
        await image_ocr({"file_id": str(uuid.uuid4())}, ToolContext())
    assert error.value.code is ToolErrorCode.FILE_CONTEXT_REQUIRED


# ── 剪贴板 ────────────────────────────────────────────────────────────────────


def test_read_clipboard_is_desktop_only_and_never_idempotent() -> None:
    """剪贴板只在本机执行；内容随时变化，不能声明为幂等。"""

    assert READ_CLIPBOARD_SPEC.execution_location == "desktop"
    assert READ_CLIPBOARD_SPEC.execution_locations == {"desktop"}
    assert READ_CLIPBOARD_SPEC.idempotent is False


def test_read_clipboard_risk_forces_per_call_approval() -> None:
    """phase-6 §9.4 要求每次确认；read 等级会被 PolicyEngine 自动放行，因此必须更高。"""

    assert READ_CLIPBOARD_SPEC.risk_level is not ToolRisk.read
    assert READ_CLIPBOARD_SPEC.risk_level is not ToolRisk.low


@pytest.mark.asyncio
async def test_read_clipboard_fails_closed_in_api_process() -> None:
    """云端不得代为读取本机剪贴板。"""

    with pytest.raises(ToolError, match="DESKTOP_TOOL_REQUIRES_NODE"):
        await read_clipboard({}, ToolContext())


def test_desktop_builtins_include_read_clipboard() -> None:
    """剪贴板必须注册进 Desktop 工具集合，否则节点侧实现永远收不到作业。"""

    assert (READ_CLIPBOARD_SPEC, read_clipboard) in DESKTOP_BUILTINS
