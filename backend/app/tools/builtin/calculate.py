"""无副作用的安全算术工具。"""

from __future__ import annotations

import ast
import math
import operator
from collections.abc import Callable

from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

CALCULATE_SPEC = ToolSpec(
    name="calculate",
    description="计算受限的数值算术表达式，不执行函数、属性或变量访问。",
    input_schema={
        "type": "object",
        "properties": {"expression": {"type": "string", "minLength": 1, "maxLength": 256}},
        "required": ["expression"],
        "additionalProperties": False,
    },
    output_schema={"type": "object", "properties": {"result": {"type": "number"}}},
    risk_level=ToolRisk.read,
    execution_location="cloud",
    timeout_seconds=5,
    idempotent=True,
)

Number = int | float
NumberBinaryOperator = Callable[[Number, Number], Number]
NumberUnaryOperator = Callable[[Number], Number]

_BINARY_OPERATORS: dict[type[ast.operator], NumberBinaryOperator] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPERATORS: dict[type[ast.unaryop], NumberUnaryOperator] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_MAX_ABS_RESULT = 10**12


def _evaluate(node: ast.AST) -> int | float:
    """只递归求值数字和白名单算术节点。"""

    if isinstance(node, ast.Expression):
        return _evaluate(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        if isinstance(node.value, bool) or not math.isfinite(float(node.value)):
            raise ValueError("non-finite number")
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        unary_operation = _UNARY_OPERATORS[type(node.op)]
        value = _evaluate(node.operand)
        result = unary_operation(value)
    elif isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        binary_operation = _BINARY_OPERATORS[type(node.op)]
        left = _evaluate(node.left)
        right = _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        result = binary_operation(left, right)
    else:
        raise ValueError("unsupported expression")
    if not math.isfinite(float(result)) or abs(float(result)) > _MAX_ABS_RESULT:
        raise ValueError("result out of bounds")
    return result


async def calculate(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """计算表达式并限制语法、深度、指数和结果范围。"""

    expression = arguments.get("expression")
    if not isinstance(expression, str):
        raise ToolError(ToolErrorCode.CALCULATION_FAILED)
    try:
        tree = ast.parse(expression, mode="eval")
        result = _evaluate(tree)
    except (ArithmeticError, SyntaxError, ValueError, TypeError) as error:
        raise ToolError(ToolErrorCode.CALCULATION_FAILED) from error
    return {"result": result}
