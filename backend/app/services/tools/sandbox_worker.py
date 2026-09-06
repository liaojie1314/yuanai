"""Sandbox 子进程：只允许有限的算术和内存数据表达式。"""

from __future__ import annotations

import ast
import json
import math
import operator
import sys
from collections.abc import Callable
from typing import cast

Binary = Callable[[object, object], object]
Unary = Callable[[object], object]

_BINARY: dict[type[ast.operator], Binary] = {
    ast.Add: cast(Binary, operator.add),
    ast.Sub: cast(Binary, operator.sub),
    ast.Mult: cast(Binary, operator.mul),
    ast.Div: cast(Binary, operator.truediv),
    ast.FloorDiv: cast(Binary, operator.floordiv),
    ast.Mod: cast(Binary, operator.mod),
    ast.Pow: cast(Binary, operator.pow),
}
_UNARY: dict[type[ast.unaryop], Unary] = {
    ast.UAdd: cast(Unary, operator.pos),
    ast.USub: cast(Unary, operator.neg),
}
_ALLOWED_CALLS: dict[str, Callable[..., object]] = {
    "len": cast(Callable[..., object], len),
    "sum": cast(Callable[..., object], sum),
    "min": cast(Callable[..., object], min),
    "max": cast(Callable[..., object], max),
    "abs": cast(Callable[..., object], abs),
}


def _evaluate(node: ast.AST, values: dict[str, object]) -> object:
    """递归执行不含属性、导入、文件或网络访问的 AST。"""

    if isinstance(node, ast.Expression):
        return _evaluate(node.body, values)
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool)):
        if isinstance(node.value, float) and not math.isfinite(node.value):
            raise ValueError("non-finite value")
        return node.value
    if isinstance(node, ast.Name) and node.id in values:
        return values[node.id]
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        items = [_evaluate(item, values) for item in node.elts]
        return (
            items
            if isinstance(node, ast.List)
            else tuple(items)
            if isinstance(node, ast.Tuple)
            else set(items)
        )
    if isinstance(node, ast.Dict):
        return {
            _evaluate(key, values): _evaluate(value, values)
            for key, value in zip(node.keys, node.values, strict=True)
            if key is not None
        }
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_evaluate(node.operand, values))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        return _BINARY[type(node.op)](_evaluate(node.left, values), _evaluate(node.right, values))
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _ALLOWED_CALLS
    ):
        if node.keywords:
            raise ValueError("keyword arguments are not allowed")
        return _ALLOWED_CALLS[node.func.id](*[_evaluate(arg, values) for arg in node.args])
    raise ValueError("unsupported syntax")


def execute(code: str) -> dict[str, object]:
    """执行最多 128 个 AST 节点的表达式或 print/赋值语句。"""

    tree = ast.parse(code, mode="exec")
    if len(list(ast.walk(tree))) > 128 or len(tree.body) > 20:
        raise ValueError("code is too complex")
    values: dict[str, object] = {}
    output: list[str] = []
    for statement in tree.body:
        if isinstance(statement, ast.Expr):
            value = _evaluate(statement.value, values)
            output.append(str(value))
        elif (
            isinstance(statement, ast.Assign)
            and len(statement.targets) == 1
            and isinstance(statement.targets[0], ast.Name)
        ):
            values[statement.targets[0].id] = _evaluate(statement.value, values)
        else:
            raise ValueError("only expressions and simple assignments are allowed")
    return {"status": "succeeded", "stdout": "\n".join(output)[:8_000], "variables": values}


def main() -> None:
    """从 stdin 读取单个 JSON 请求并输出单个 JSON 响应。"""

    try:
        request = json.loads(sys.stdin.read())
        code = request.get("code") if isinstance(request, dict) else None
        if not isinstance(code, str):
            raise ValueError("code is required")
        response = execute(code)
    except (SyntaxError, TypeError, ValueError, ArithmeticError) as error:
        response = {
            "status": "failed",
            "error": "SANDBOX_CODE_INVALID",
            "message": str(error)[:200],
        }
    print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
