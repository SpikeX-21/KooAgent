"""Optional adapters for calling Operit Android Runtime tools over HTTP."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .base import Tool


@dataclass
class OperitToolResult:
    tool_name: str
    success: bool
    result_text: str
    result_json: str | None = None
    error: str | None = None
    latency_ms: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class OperitDeviceClient:
    """Small SDK that makes Operit remote tools feel like local calls."""

    def __init__(
        self,
        base_url: str,
        bearer_token: str,
        timeout: float = 15.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.timeout = timeout

    def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> OperitToolResult:
        payload = {
            "toolName": tool_name,
            "arguments": self._stringify_arguments(arguments or {}),
        }
        request = urllib.request.Request(
            f"{self.base_url}/api/device/tool-call",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.bearer_token}",
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            return OperitToolResult(
                tool_name=tool_name,
                success=False,
                result_text="",
                error=f"HTTP {e.code}: {error_body}",
            )
        except urllib.error.URLError as e:
            return OperitToolResult(
                tool_name=tool_name,
                success=False,
                result_text="",
                error=str(e.reason),
            )
        except TimeoutError:
            return OperitToolResult(
                tool_name=tool_name,
                success=False,
                result_text="",
                error="timed out",
            )

        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError:
            return OperitToolResult(
                tool_name=tool_name,
                success=False,
                result_text="",
                error=f"invalid JSON response: {response_body}",
            )

        return OperitToolResult(
            tool_name=str(parsed.get("toolName") or tool_name),
            success=bool(parsed.get("success", False)),
            result_text=str(parsed.get("resultText") or ""),
            result_json=parsed.get("resultJson"),
            error=parsed.get("error"),
            latency_ms=parsed.get("latencyMs"),
            raw=parsed,
        )

    def list_installed_apps(self) -> OperitToolResult:
        return self.call_tool("list_installed_apps", {})

    @staticmethod
    def _stringify_arguments(arguments: dict[str, Any]) -> dict[str, str]:
        stringified: dict[str, str] = {}
        for key, value in arguments.items():
            if value is None:
                continue
            if isinstance(value, bool):
                stringified[key] = "true" if value else "false"
            else:
                stringified[key] = str(value)
        return stringified


@dataclass(frozen=True)
class OperitToolSpec:
    local_name: str
    remote_name: str
    description: str
    parameters: dict[str, Any]


class OperitRemoteTool(Tool):
    def __init__(self, client: OperitDeviceClient, spec: OperitToolSpec):
        self.client = client
        self.spec = spec
        self.name = spec.local_name
        self.description = spec.description
        self.parameters = spec.parameters

    def execute(self, **kwargs) -> str:
        result = self.client.call_tool(self.spec.remote_name, kwargs)
        if not result.success:
            return f"Error from Android Runtime ({result.tool_name}): {result.error or 'unknown error'}"
        return result.result_text


class AndroidRemoteTool(OperitRemoteTool):
    """Backward-compatible single-tool adapter for list_installed_apps."""

    def __init__(
        self,
        base_url: str,
        bearer_token: str,
        timeout: float = 15.0,
    ):
        client = OperitDeviceClient(base_url=base_url, bearer_token=bearer_token, timeout=timeout)
        super().__init__(client, _OPERIT_TOOL_SPECS[0])

    def execute(self) -> str:
        return super().execute()


def create_operit_tools(
    base_url: str,
    bearer_token: str,
    timeout: float = 15.0,
) -> list[Tool]:
    client = OperitDeviceClient(base_url=base_url, bearer_token=bearer_token, timeout=timeout)
    return [OperitRemoteTool(client, spec) for spec in _OPERIT_TOOL_SPECS]


def _schema(properties: dict[str, dict[str, Any]], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
    }


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _integer(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description}


def _number(description: str) -> dict[str, Any]:
    return {"type": "number", "description": description}


def _boolean(description: str) -> dict[str, Any]:
    return {"type": "boolean", "description": description}


_OPERIT_TOOL_SPECS = [
    OperitToolSpec(
        local_name="android_list_installed_apps",
        remote_name="list_installed_apps",
        description="List installed third-party Android apps through Operit.",
        parameters=_schema({}),
    ),
    OperitToolSpec(
        local_name="android_sleep",
        remote_name="sleep",
        description="Pause briefly on the Android runtime.",
        parameters=_schema({"duration_ms": _integer("milliseconds, default 1000, >= 0")}),
    ),
    OperitToolSpec(
        local_name="android_use_package",
        remote_name="use_package",
        description="Activate an Operit dynamic package for this Android runtime session.",
        parameters=_schema({"package_name": _string("package name to activate")}, ["package_name"]),
    ),
    OperitToolSpec(
        local_name="android_list_files",
        remote_name="list_files",
        description="List files in an Android/Linux/repository path through Operit.",
        parameters=_schema(
            {
                "path": _string("directory path, e.g. /sdcard/Download"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_read_file",
        remote_name="read_file",
        description="Read a file through Operit; image files may be OCR-extracted by Operit.",
        parameters=_schema(
            {
                "path": _string("file path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "intent": _string("optional question about the media/file"),
                "direct_image": _boolean("return image link for vision-capable models"),
                "direct_audio": _boolean("return audio link for audio-capable models"),
                "direct_video": _boolean("return video link for video-capable models"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_read_file_part",
        remote_name="read_file_part",
        description="Read a file line range through Operit.",
        parameters=_schema(
            {
                "path": _string("file path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "start_line": _integer("starting line number, 1-indexed"),
                "end_line": _integer("ending line number, 1-indexed, inclusive"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_apply_file",
        remote_name="apply_file",
        description="Apply a create/replace/delete style file operation through Operit.",
        parameters=_schema(
            {
                "path": _string("file path"),
                "type": _string("operation type expected by Operit, e.g. create, replace, delete"),
                "old": _string("old exact text for replacement"),
                "new": _string("new text or full file content"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_create_file",
        remote_name="create_file",
        description="Create a file through Operit.",
        parameters=_schema(
            {
                "path": _string("file path"),
                "new": _string("full file content"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
            },
            ["path", "new"],
        ),
    ),
    OperitToolSpec(
        local_name="android_edit_file",
        remote_name="edit_file",
        description="Edit a file by exact text replacement through Operit.",
        parameters=_schema(
            {
                "path": _string("file path"),
                "old": _string("exact content to match"),
                "new": _string("new content"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
            },
            ["path", "old", "new"],
        ),
    ),
    OperitToolSpec(
        local_name="android_delete_file",
        remote_name="delete_file",
        description="Delete a file or directory through Operit.",
        parameters=_schema(
            {
                "path": _string("target path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "recursive": _boolean("delete directories recursively"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_make_directory",
        remote_name="make_directory",
        description="Create a directory through Operit.",
        parameters=_schema(
            {
                "path": _string("directory path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "create_parents": _boolean("create missing parent directories"),
            },
            ["path"],
        ),
    ),
    OperitToolSpec(
        local_name="android_find_files",
        remote_name="find_files",
        description="Find files matching a pattern through Operit.",
        parameters=_schema(
            {
                "path": _string("search path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "pattern": _string("file pattern, e.g. *.jpg"),
                "max_depth": _integer("subdirectory search depth; -1 means unlimited"),
                "use_path_pattern": _boolean("treat pattern as a path pattern"),
                "case_insensitive": _boolean("case-insensitive matching"),
            },
            ["path", "pattern"],
        ),
    ),
    OperitToolSpec(
        local_name="android_grep_code",
        remote_name="grep_code",
        description="Search code with a regex pattern through Operit.",
        parameters=_schema(
            {
                "path": _string("search path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "pattern": _string("regex pattern"),
                "file_pattern": _string("file filter"),
                "case_insensitive": _boolean("case-insensitive matching"),
                "context_lines": _integer("context lines around each match"),
                "max_results": _integer("maximum matches"),
            },
            ["path", "pattern"],
        ),
    ),
    OperitToolSpec(
        local_name="android_grep_context",
        remote_name="grep_context",
        description="Search relevant files or code segments by intent through Operit.",
        parameters=_schema(
            {
                "path": _string("directory or file path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "intent": _string("intent or context description"),
                "file_pattern": _string("file filter for directory mode"),
                "max_results": _integer("maximum returned items"),
            },
            ["path", "intent"],
        ),
    ),
    OperitToolSpec(
        local_name="android_visit_web",
        remote_name="visit_web",
        description="Visit a webpage and extract readable information through Operit.",
        parameters=_schema(
            {
                "url": _string("webpage URL"),
                "visit_key": _string("visitKey from a previous visit_web result"),
                "link_number": _integer("1-based link index from previous Results"),
                "include_image_links": _boolean("include extracted image links"),
                "headers": _string("optional HTTP headers JSON object string"),
                "user_agent_preset": _string("desktop or android"),
                "user_agent": _string("custom user agent"),
            },
        ),
    ),
    OperitToolSpec(
        local_name="android_download_file",
        remote_name="download_file",
        description="Download a file through Operit.",
        parameters=_schema(
            {
                "url": _string("file URL"),
                "visit_key": _string("visitKey from a previous visit_web result"),
                "link_number": _integer("1-based link index from previous Results"),
                "image_number": _integer("1-based image index from previous Images"),
                "destination": _string("save path"),
                "environment": _string("optional: android, linux, or repo:<repositoryName>"),
                "headers": _string("optional HTTP headers JSON object string"),
            },
            ["destination"],
        ),
    ),
    OperitToolSpec(
        local_name="android_query_memory",
        remote_name="query_memory",
        description="Search the Operit memory library.",
        parameters=_schema(
            {
                "query": _string("natural-language query or keyword expression"),
                "folder_path": _string("folder path to search within"),
                "start_time": _string("local time YYYY-MM-DD or YYYY-MM-DD HH:mm"),
                "end_time": _string("local time YYYY-MM-DD or YYYY-MM-DD HH:mm"),
                "snapshot_id": _string("snapshot id to reuse across queries"),
                "threshold": _number("minimum relevance score"),
                "limit": _integer("maximum number of results"),
            },
            ["query"],
        ),
    ),
    OperitToolSpec(
        local_name="android_get_memory_by_title",
        remote_name="get_memory_by_title",
        description="Read an Operit memory by exact title.",
        parameters=_schema(
            {
                "title": _string("exact memory title"),
                "chunk_index": _integer("specific chunk number"),
                "chunk_range": _string("chunk range like 3-7"),
                "query": _string("search inside the document"),
                "limit": _integer("maximum chunks when using query"),
            },
            ["title"],
        ),
    ),
]
