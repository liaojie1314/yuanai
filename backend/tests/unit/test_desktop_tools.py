"""Desktop 本地文件工具的契约与入参校验测试。"""

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.tool_runtime_service import ToolRuntimeError, ToolRuntimeService
from app.tools.builtin.desktop import (
    DESKTOP_BUILTINS,
    LIST_GRANTED_DIRECTORY_SPEC,
    READ_GRANTED_FILE_SPEC,
    WRITE_WORKSPACE_FILE_SPEC,
    list_granted_directory,
    read_granted_file,
    write_workspace_file,
)
from app.tools.contracts import ToolContext, ToolError, ToolRisk
from app.tools.registry import ToolRegistry, validate_arguments_against_schema


async def test_desktop_file_tools_fail_closed_in_api_process() -> None:
    """占位 handler 必须拒绝在 API 进程执行任何本地文件操作。"""

    context = ToolContext()
    for handler, arguments in (
        (read_granted_file, {"resource_id": "r1"}),
        (list_granted_directory, {"resource_id": "r1"}),
        (write_workspace_file, {"relative_path": "a.txt", "content": "hi"}),
    ):
        with pytest.raises(ToolError, match="DESKTOP_TOOL_REQUIRES_NODE"):
            await handler(arguments, context)


def test_desktop_file_tools_share_node_only_execution_location() -> None:
    """三个文件工具都只允许 desktop 执行位置，并带正确风险级别。"""

    assert [spec.name for spec, _handler in DESKTOP_BUILTINS] == [
        "browser_open_url",
        "read_granted_file",
        "list_granted_directory",
        "write_workspace_file",
    ]
    for spec, _handler in DESKTOP_BUILTINS:
        assert spec.execution_location == "desktop"
        assert spec.execution_locations == {"desktop"}
    assert READ_GRANTED_FILE_SPEC.risk_level is ToolRisk.read
    assert LIST_GRANTED_DIRECTORY_SPEC.risk_level is ToolRisk.read
    assert WRITE_WORKSPACE_FILE_SPEC.risk_level is ToolRisk.local_write


@pytest.mark.parametrize(
    "arguments",
    [
        {"resource_id": "r" * 201},
        {"resource_id": "r1", "encoding": "hex"},
        {"resource_id": "r1", "max_bytes": 0},
        {"resource_id": "r1", "max_bytes": 24_577},
        {"resource_id": "r1", "extra": True},
        {},
    ],
)
def test_read_granted_file_rejects_invalid_input(arguments: dict[str, object]) -> None:
    """读取工具的 schema 边界必须把非法参数全部挡下。"""

    from app.tools.registry import ToolValidationError

    with pytest.raises(ToolValidationError):
        validate_arguments_against_schema(arguments, READ_GRANTED_FILE_SPEC.input_schema)


@pytest.mark.parametrize(
    "arguments",
    [
        {"resource_id": "r1", "max_entries": 201},
        {"resource_id": ""},
    ],
)
def test_list_granted_directory_rejects_invalid_input(arguments: dict[str, object]) -> None:
    """目录列举工具的条目上限和资源 ID 长度必须生效。"""

    from app.tools.registry import ToolValidationError

    with pytest.raises(ToolValidationError):
        validate_arguments_against_schema(arguments, LIST_GRANTED_DIRECTORY_SPEC.input_schema)


@pytest.mark.parametrize(
    "relative_path",
    [
        "/etc/passwd",
        "../escape",
        "a/../b",
        "a/..",
        "..",
        "a\\b.txt",
        "C:/temp/x.txt",
        "C:relative.txt",
        "",
        "a/\x00b",
    ],
)
def test_write_workspace_file_rejects_unsafe_paths(relative_path: str) -> None:
    """工作区写入只接受受限相对路径，绝对路径与穿越段全部拒绝。"""

    from app.tools.registry import ToolValidationError

    arguments = {"relative_path": relative_path, "content": "hello"}
    with pytest.raises(ToolValidationError):
        validate_arguments_against_schema(arguments, WRITE_WORKSPACE_FILE_SPEC.input_schema)


@pytest.mark.parametrize(
    "relative_path",
    ["report.md", "nested/dir/report.csv", "a..b/notes.txt", "数据/结果.json"],
)
def test_write_workspace_file_accepts_safe_relative_paths(relative_path: str) -> None:
    """普通相对路径（含 Unicode 与含点目录名）必须放行。"""

    arguments = {"relative_path": relative_path, "content": "hello"}
    validated = validate_arguments_against_schema(arguments, WRITE_WORKSPACE_FILE_SPEC.input_schema)
    assert validated["relative_path"] == relative_path


async def test_desktop_file_tools_require_registered_node_capability(
    db: AsyncSession, test_user
) -> None:
    """桌面文件执行必须绑定已登记节点，且节点能力必须声明该工具。"""

    service = ToolRuntimeService()
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_REQUIRED"):
        await service.create_execution(
            user_id=test_user.id,
            tool_name="read_granted_file",
            arguments={"resource_id": "r1"},
            execution_location="desktop",
            db=db,
        )

    private_key = Ed25519PrivateKey.generate()
    from app.services.tool_runtime_service import encode_public_key

    node, pairing_code = await service.create_pairing(
        user_id=test_user.id,
        name="Files Desktop",
        platform="linux",
        app_version="0.1.0",
        capabilities=["read_granted_file", "list_granted_directory", "write_workspace_file"],
        db=db,
    )
    registered, _token, _expires_at = await service.register_node(
        pairing_code=pairing_code,
        public_key=encode_public_key(private_key.public_key()),
        name=node.name,
        platform=node.platform,
        app_version=node.app_version,
        capabilities=["read_granted_file", "list_granted_directory", "write_workspace_file"],
        protocol_version=settings.execution_node_protocol_version,
        db=db,
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="read_granted_file",
        arguments={"resource_id": "r1"},
        execution_location="desktop",
        node_id=registered.id,
        db=db,
    )
    assert execution.node_id == registered.id
    assert execution.arguments_encrypted is not None
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_TOOL_NOT_ALLOWED"):
        await service.create_execution(
            user_id=test_user.id,
            tool_name="browser_open_url",
            arguments={"url": "https://example.com"},
            execution_location="desktop",
            node_id=registered.id,
            db=db,
        )


def test_registry_rejects_duplicate_desktop_registration() -> None:
    """同名工具重复注册仍然拒绝，文件工具不得覆盖已有定义。"""

    from app.tools.contracts import ToolRegistrationError

    registry = ToolRegistry()
    for spec, handler in DESKTOP_BUILTINS:
        registry.register(spec, handler)
    with pytest.raises(ToolRegistrationError):
        registry.register(DESKTOP_BUILTINS[0][0], DESKTOP_BUILTINS[0][1])
