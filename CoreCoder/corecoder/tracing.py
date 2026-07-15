"""JSONL tracing for CoreCoder agent runs."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


class TraceSink(Protocol):
    """Small tracing interface used by the agent loop."""

    def tool_result(
        self,
        *,
        round_index: int,
        tool_call_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        started_at: str,
        finished_at: str,
        success: bool,
        error: str,
        result_text: str,
    ) -> None:
        ...

    def final_answer(self, *, round_index: int, answer: str) -> None:
        ...

    def max_steps(self, *, max_rounds: int, answer: str) -> None:
        ...


class JsonlTraceWriter:
    """Append agent-loop trace events to a JSONL file."""

    def __init__(self, path: str | Path, preview_chars: int = 1000):
        self.path = Path(path)
        self.preview_chars = preview_chars
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def tool_result(
        self,
        *,
        round_index: int,
        tool_call_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        started_at: str,
        finished_at: str,
        success: bool,
        error: str,
        result_text: str,
    ) -> None:
        self._write(
            {
                "event": "tool_result",
                "timestamp": finished_at,
                "round": round_index,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "arguments": arguments,
                "started_at": started_at,
                "finished_at": finished_at,
                "success": success,
                "error": error,
                "result_preview": self._preview(result_text),
            }
        )

    def final_answer(self, *, round_index: int, answer: str) -> None:
        timestamp = utc_now_iso()
        self._write(
            {
                "event": "final_answer",
                "timestamp": timestamp,
                "round": round_index,
                "answer": answer,
            }
        )

    def max_steps(self, *, max_rounds: int, answer: str) -> None:
        timestamp = utc_now_iso()
        self._write(
            {
                "event": "max_steps",
                "timestamp": timestamp,
                "max_rounds": max_rounds,
                "answer": answer,
            }
        )

    def _write(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False, default=str) + "\n"
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line)

    def _preview(self, text: str) -> str:
        if len(text) <= self.preview_chars:
            return text
        return text[: self.preview_chars] + "...[truncated]"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
