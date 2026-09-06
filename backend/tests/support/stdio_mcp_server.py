"""用于集成测试的最小 MCP stdio server。"""

from __future__ import annotations

import json
import os
import sys


def main() -> None:
    """读取 newline-delimited JSON-RPC，并返回固定的测试工具结果。"""

    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method")
        request_id = request.get("id")
        if request_id is None:
            continue
        if method == "initialize":
            result: dict[str, object] = {
                "protocolVersion": request["params"]["protocolVersion"],
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "test-stdio", "version": "1.0.0"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "lookup",
                        "description": "test lookup",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"query": {"type": "string", "minLength": 1}},
                            "required": ["query"],
                            "additionalProperties": False,
                        },
                        "annotations": {"readOnlyHint": True},
                    }
                ]
            }
        elif method == "tools/call":
            query = request["params"]["arguments"]["query"]
            if query == "hang":
                import time

                time.sleep(2)
            if query == "large":
                text = "x" * 4_096
            else:
                text = (
                    f"{query}:"
                    f"{os.environ.get('MCP_AUTH_TOKEN', '')}:"
                    f"worker={os.environ.get('YUANAI_MCP_STDIO_WORKER', '')}:"
                    f"parent={os.getppid()}"
                )
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": text,
                    }
                ]
            }
        else:
            result = {}
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
