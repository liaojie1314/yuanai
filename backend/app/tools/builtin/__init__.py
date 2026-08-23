"""三个无副作用内置工具。"""

from app.tools.builtin.calculate import CALCULATE_SPEC, calculate
from app.tools.builtin.current_time import CURRENT_TIME_SPEC, get_current_time
from app.tools.builtin.file_metadata import (
    FILE_METADATA_SPEC,
    inspect_uploaded_file_metadata,
)
from app.tools.registry import ToolRegistry


def build_builtin_registry() -> ToolRegistry:
    """构造只包含三个内置工具的新注册表。"""

    registry = ToolRegistry()
    registry.register(CALCULATE_SPEC, calculate)
    registry.register(CURRENT_TIME_SPEC, get_current_time)
    registry.register(FILE_METADATA_SPEC, inspect_uploaded_file_metadata)
    return registry


create_builtin_registry = build_builtin_registry

__all__ = [
    "build_builtin_registry",
    "create_builtin_registry",
    "calculate",
    "get_current_time",
    "inspect_uploaded_file_metadata",
]
