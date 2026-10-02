"""进程内 Prometheus 文本格式指标，以及 Phase 5 §14 规定的 8 个 Agent 具名指标。

只实现 counter 与 histogram 两种类型：8 个指标全部可由这两种表达，因此不引入
prometheus-client 依赖。指标存在进程内存中，多进程部署（API + 四个 worker）下
每个进程各自暴露自己的值，由采集端按 instance 聚合；进程重启即归零，属 counter
的正常语义。

指标只携带低基数标签（status / model / tool / direction / reason），不含用户内容、
原始用户标识或凭证 —— 用户维度的脱敏日志在 ``app/services/agent/metrics.py``。
"""

from __future__ import annotations

import bisect
import threading
from typing import Final

# ponytail: 一把全局锁护住所有指标写入；每次写入都是 O(1) 字典操作，真成瓶颈再按指标拆锁。
_LOCK: Final[threading.Lock] = threading.Lock()
_REGISTRY: Final[list[_Metric]] = []

DURATION_BUCKETS: Final[tuple[float, ...]] = (
    0.1,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
)
STEP_BUCKETS: Final[tuple[float, ...]] = (1.0, 2.0, 4.0, 8.0, 12.0, 20.0, 40.0)


def _escape_label_value(value: str) -> str:
    """按 Prometheus 文本格式转义标签取值。"""

    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _format_number(value: float) -> str:
    """输出 Prometheus 可解析的数值；整数不走科学计数法，避免 token 计数丢精度。"""

    if value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return repr(value)


class _Metric:
    """具名指标的公共部分：名称、说明、标签维度与注册。"""

    def __init__(self, name: str, documentation: str, labelnames: tuple[str, ...] = ()) -> None:
        self.name = name
        self.documentation = documentation
        self.labelnames = labelnames
        _REGISTRY.append(self)

    def _key(self, labels: dict[str, str]) -> tuple[str, ...]:
        """校验标签集合完整，并按声明顺序返回取值元组。"""

        if set(labels) != set(self.labelnames):
            raise ValueError(f"{self.name} 需要标签 {self.labelnames}，收到 {sorted(labels)}")
        return tuple(str(labels[name]) for name in self.labelnames)

    def _series(self, key: tuple[str, ...], extra: tuple[tuple[str, str], ...] = ()) -> str:
        """渲染一条序列的标签部分，无标签时返回空串。"""

        pairs = list(zip(self.labelnames, key, strict=True)) + list(extra)
        if not pairs:
            return ""
        body = ",".join(f'{name}="{_escape_label_value(value)}"' for name, value in pairs)
        return "{" + body + "}"

    def render(self) -> list[str]:
        """渲染本指标的全部文本行。"""

        raise NotImplementedError


class Counter(_Metric):
    """单调递增计数器。"""

    def __init__(self, name: str, documentation: str, labelnames: tuple[str, ...] = ()) -> None:
        super().__init__(name, documentation, labelnames)
        self._values: dict[tuple[str, ...], float] = {}

    def inc(self, amount: float = 1.0, **labels: str) -> None:
        """按标签累加计数；负增量会破坏 counter 语义，直接拒绝。"""

        if amount < 0:
            raise ValueError(f"{self.name} 不接受负增量")
        key = self._key(labels)
        with _LOCK:
            self._values[key] = self._values.get(key, 0.0) + amount

    def render(self) -> list[str]:
        """渲染 HELP / TYPE 与各标签组合的当前计数。"""

        with _LOCK:
            items = sorted(self._values.items())
        lines = [f"# HELP {self.name} {self.documentation}", f"# TYPE {self.name} counter"]
        lines.extend(
            f"{self.name}{self._series(key)} {_format_number(value)}" for key, value in items
        )
        return lines


class Histogram(_Metric):
    """固定桶直方图，输出 ``_bucket`` / ``_sum`` / ``_count`` 三组序列。"""

    def __init__(
        self,
        name: str,
        documentation: str,
        labelnames: tuple[str, ...] = (),
        *,
        buckets: tuple[float, ...] = DURATION_BUCKETS,
    ) -> None:
        if not buckets or list(buckets) != sorted(buckets):
            raise ValueError(f"{name} 的桶边界必须非空且升序")
        super().__init__(name, documentation, labelnames)
        self._buckets = buckets
        # 每个标签组合一个计数数组，长度为桶数 + 1，最后一格是 +Inf
        self._counts: dict[tuple[str, ...], list[int]] = {}
        self._sums: dict[tuple[str, ...], float] = {}

    def observe(self, value: float, **labels: str) -> None:
        """记录一次观测值。"""

        key = self._key(labels)
        # bisect_left 返回第一个 >= value 的边界下标，正是 Prometheus 的 le 语义
        index = bisect.bisect_left(self._buckets, value)
        with _LOCK:
            counts = self._counts.setdefault(key, [0] * (len(self._buckets) + 1))
            counts[index] += 1
            self._sums[key] = self._sums.get(key, 0.0) + value

    def render(self) -> list[str]:
        """渲染 HELP / TYPE 与累计桶、总和、总次数。"""

        with _LOCK:
            items = [(key, list(counts)) for key, counts in sorted(self._counts.items())]
            sums = dict(self._sums)
        lines = [f"# HELP {self.name} {self.documentation}", f"# TYPE {self.name} histogram"]
        for key, counts in items:
            cumulative = 0
            for bound, count in zip(self._buckets, counts, strict=False):
                cumulative += count
                bucket = self._series(key, (("le", _format_number(bound)),))
                lines.append(f"{self.name}_bucket{bucket} {cumulative}")
            cumulative += counts[-1]
            inf_bucket = self._series(key, (("le", "+Inf"),))
            lines.append(f"{self.name}_bucket{inf_bucket} {cumulative}")
            lines.append(f"{self.name}_sum{self._series(key)} {_format_number(sums[key])}")
            lines.append(f"{self.name}_count{self._series(key)} {cumulative}")
        return lines


def render_metrics() -> str:
    """把全部已注册指标渲染为 Prometheus 文本格式（以换行结尾）。"""

    lines: list[str] = []
    for metric in _REGISTRY:
        lines.extend(metric.render())
    return "\n".join(lines) + "\n"


# ── Phase 5 §14 规定的 8 个 Agent 运行时指标 ──────────────────────────────
AGENT_RUNS_TOTAL: Final = Counter(
    "agent_runs_total", "Agent Run 片段的终态计数", ("status", "model")
)
AGENT_RUN_DURATION_SECONDS: Final = Histogram(
    "agent_run_duration_seconds", "Agent Run 从开始到终态的墙钟耗时（秒）"
)
AGENT_STEPS_PER_RUN: Final = Histogram(
    "agent_steps_per_run", "单次 Agent Run 结束时的 Step 数", buckets=STEP_BUCKETS
)
AGENT_TOOL_CALLS_TOTAL: Final = Counter(
    "agent_tool_calls_total", "Agent 工具调用结果计数", ("tool", "status")
)
AGENT_APPROVAL_WAIT_SECONDS: Final = Histogram(
    "agent_approval_wait_seconds", "审批请求从创建到用户决定的等待时长（秒）"
)
AGENT_RECOVERY_TOTAL: Final = Counter("agent_recovery_total", "Run 恢复重投计数", ("reason",))
AGENT_TOKENS_TOTAL: Final = Counter(
    "agent_tokens_total", "Agent Run 消耗的 token 数", ("model", "direction")
)
AGENT_ESTIMATED_COST_USD: Final = Counter(
    "agent_estimated_cost_usd", "Agent Run 的估算成本（美元）", ("model",)
)
