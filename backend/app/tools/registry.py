"""代码内显式注册的有界 ToolRegistry。"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from collections.abc import Mapping

from app.tools.contracts import (
    ToolArguments,
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolExecutionError,
    ToolHandler,
    ToolOutput,
    ToolRegistrationError,
    ToolSpec,
    ToolValidationError,
)


def _schema_error() -> ToolValidationError:
    """构造不泄漏参数内容的统一 schema 错误。"""

    return ToolValidationError()


def _validate_pattern(value: str, schema: Mapping[str, object]) -> None:
    """按 JSON Schema 语义执行未锚定的 pattern 子串匹配。"""

    pattern = schema.get("pattern")
    if not isinstance(pattern, str):
        return
    try:
        if re.search(pattern, value) is None:
            raise _schema_error()
    except re.error as error:
        raise _schema_error() from error


def _validate_number_bounds(value: int | float, schema: Mapping[str, object]) -> None:
    """校验数值字段的 minimum 和 maximum 边界。"""

    minimum = schema.get("minimum")
    maximum = schema.get("maximum")
    if isinstance(minimum, (int, float)) and not isinstance(minimum, bool) and value < minimum:
        raise _schema_error()
    if isinstance(maximum, (int, float)) and not isinstance(maximum, bool) and value > maximum:
        raise _schema_error()


def _validate_schema(value: object, schema: Mapping[str, object]) -> None:
    """验证工具使用到的有限 JSON Schema 子集。"""

    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(value, Mapping):
            raise _schema_error()
        properties = schema.get("properties", {})
        if not isinstance(properties, Mapping):
            raise _schema_error()
        required = schema.get("required", [])
        if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
            raise _schema_error()
        if any(key not in value for key in required):
            raise _schema_error()
        if schema.get("additionalProperties") is False and any(
            key not in properties for key in value
        ):
            raise _schema_error()
        for key, child_schema in properties.items():
            if key in value and isinstance(child_schema, Mapping):
                _validate_schema(value[key], child_schema)
    elif expected_type == "string":
        if not isinstance(value, str):
            raise _schema_error()
        min_length = schema.get("minLength")
        max_length = schema.get("maxLength")
        if isinstance(min_length, int) and len(value) < min_length:
            raise _schema_error()
        if isinstance(max_length, int) and len(value) > max_length:
            raise _schema_error()
        _validate_pattern(value, schema)
    elif expected_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise _schema_error()
        _validate_number_bounds(value, schema)
    elif expected_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise _schema_error()
        _validate_number_bounds(value, schema)
    elif expected_type == "boolean":
        if not isinstance(value, bool):
            raise _schema_error()
    elif expected_type == "array":
        if not isinstance(value, list):
            raise _schema_error()
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(value) > max_items:
            raise _schema_error()
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for item in value:
                _validate_schema(item, item_schema)
    elif expected_type is not None:
        raise _schema_error()

    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        raise _schema_error()


def validate_arguments_against_schema(
    arguments: Mapping[str, object], schema: Mapping[str, object]
) -> dict[str, object]:
    """验证外部工具 schema 的有限 JSON Schema 子集。"""

    if not isinstance(arguments, Mapping):
        raise ToolValidationError()
    arguments_dict = dict(arguments)
    _validate_schema(arguments_dict, schema)
    return arguments_dict


class ToolRegistry:
    """管理工具 schema、输入校验、超时和稳定错误包装。"""

    def __init__(self, *, max_output_bytes: int = 32 * 1024) -> None:
        if max_output_bytes <= 0:
            raise ValueError("max_output_bytes must be positive")
        self._max_output_bytes = max_output_bytes
        self._handlers: dict[str, ToolHandler] = {}
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec, handler: ToolHandler) -> None:
        """显式注册一个工具；同名注册始终拒绝覆盖。"""

        if spec.name in self._specs:
            raise ToolRegistrationError(ToolErrorCode.DUPLICATE)
        self._specs[spec.name] = spec
        self._handlers[spec.name] = handler

    def get_spec(self, name: str) -> ToolSpec:
        """返回工具描述，不存在时抛出稳定错误。"""

        try:
            return self._specs[name]
        except KeyError as error:
            raise ToolRegistrationError(ToolErrorCode.NOT_FOUND) from error

    def list_specs(self) -> list[ToolSpec]:
        """返回按名称稳定排序的工具描述副本。"""

        return [self._specs[name] for name in sorted(self._specs)]

    def validate_arguments(self, name: str, arguments: ToolArguments) -> dict[str, object]:
        """校验工具参数并返回普通字典，供审计和执行共用。"""

        spec = self.get_spec(name)
        try:
            arguments_dict = validate_arguments_against_schema(arguments, spec.input_schema)
        except ToolValidationError:
            raise
        except (TypeError, ValueError) as error:
            raise ToolValidationError() from error
        return arguments_dict

    async def execute(
        self,
        name: str,
        arguments: ToolArguments,
        *,
        context: ToolContext | None = None,
    ) -> ToolOutput:
        """校验参数并在工具声明的时间边界内执行一次调用。"""

        spec = self.get_spec(name)
        arguments_dict = self.validate_arguments(name, arguments)

        handler = self._handlers[name]
        execution_context = context or ToolContext()
        try:
            if inspect.iscoroutinefunction(handler):
                result = await asyncio.wait_for(
                    handler(arguments_dict, execution_context), timeout=spec.timeout_seconds
                )
            else:
                result = await asyncio.wait_for(
                    asyncio.to_thread(handler, arguments_dict, execution_context),
                    timeout=spec.timeout_seconds,
                )
            if inspect.isawaitable(result):
                result = await asyncio.wait_for(result, timeout=spec.timeout_seconds)
        except TimeoutError as error:
            raise ToolExecutionError(ToolErrorCode.TIMEOUT) from error
        except ToolError:
            raise
        except (KeyError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise ToolExecutionError(ToolErrorCode.EXECUTION_FAILED) from error

        try:
            encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError) as error:
            raise ToolExecutionError(ToolErrorCode.EXECUTION_FAILED) from error
        output_limit = min(self._max_output_bytes, spec.max_output_bytes)
        if len(encoded.encode("utf-8")) > output_limit:
            raise ToolExecutionError(ToolErrorCode.OUTPUT_TOO_LARGE)
        if not isinstance(result, (dict, list)):
            raise ToolExecutionError(ToolErrorCode.EXECUTION_FAILED)
        return result
