"""构建 Agent 的 provider-neutral 上下文消息。"""

from __future__ import annotations

from collections.abc import Sequence

from app.services.agent.policy import PolicyEngine

ModelMessage = dict[str, object]


class AgentContextBuilder:
    """把系统策略、用户目标、历史和工具结果拼装为模型消息。"""

    def __init__(self, policy: PolicyEngine | None = None) -> None:
        self._policy = policy or PolicyEngine()

    def build(
        self,
        *,
        goal: str,
        user_instructions: str = "",
        history: Sequence[ModelMessage] = (),
    ) -> list[ModelMessage]:
        """构建初始上下文；历史内容保持原角色，不会进入系统指令。"""

        messages = list(self._policy.build_system_messages(user_instructions))
        for message in history:
            copied = dict(message)
            # 外部历史不得追加可覆盖平台规则的 system 层。
            if copied.get("role") == "system":
                copied["role"] = "user"
            messages.append(copied)
        messages.append({"role": "user", "content": goal})
        return messages
