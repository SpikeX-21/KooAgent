"""Tests for the optional Operit Android remote tool adapter."""

import json
import importlib.util
import types
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread


def load_android_remote_module():
    tools_dir = Path(__file__).resolve().parents[1] / "corecoder" / "tools"
    package_name = "corecoder.tools"
    if package_name not in sys.modules:
        package = types.ModuleType(package_name)
        package.__path__ = [str(tools_dir)]
        sys.modules[package_name] = package

    module_name = "corecoder.tools.android_remote"
    spec = importlib.util.spec_from_file_location(module_name, tools_dir / "android_remote.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_android_remote_tool_posts_operit_tool_call():
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            seen["path"] = self.path
            seen["auth"] = self.headers.get("Authorization")
            seen["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
            response = {
                "toolName": "list_installed_apps",
                "success": True,
                "resultText": "com.example.app\ncom.android.settings",
                "startedAtMs": 1,
                "finishedAtMs": 2,
                "latencyMs": 1,
            }
            payload = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        tool = load_android_remote_module().AndroidRemoteTool(
            base_url=f"http://127.0.0.1:{server.server_port}",
            bearer_token="secret",
        )

        result = tool.execute()
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert result == "com.example.app\ncom.android.settings"
    assert seen["path"] == "/api/device/tool-call"
    assert seen["auth"] == "Bearer secret"
    assert seen["body"]["toolName"] == "list_installed_apps"
    assert seen["body"]["arguments"] == {}


def test_operit_device_client_calls_arbitrary_tool():
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            seen["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
            response = {
                "toolName": "sleep",
                "success": True,
                "resultText": "Slept for 1ms",
                "startedAtMs": 1,
                "finishedAtMs": 2,
                "latencyMs": 1,
            }
            payload = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = load_android_remote_module().OperitDeviceClient(
            base_url=f"http://127.0.0.1:{server.server_port}",
            bearer_token="secret",
        )

        result = client.call_tool("sleep", {"duration_ms": 1, "trace": True})
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert result.success is True
    assert result.result_text == "Slept for 1ms"
    assert seen["body"]["toolName"] == "sleep"
    assert seen["body"]["arguments"] == {"duration_ms": "1", "trace": "true"}


def test_create_operit_tools_exposes_builtin_android_tools():
    module = load_android_remote_module()

    tools = module.create_operit_tools(base_url="http://127.0.0.1:8094", bearer_token="secret")
    names = {tool.name for tool in tools}

    assert "android_list_installed_apps" in names
    assert "android_sleep" in names
    assert "android_list_files" in names
    assert "android_read_file" in names
    assert "android_visit_web" in names
    assert "android_query_memory" in names
