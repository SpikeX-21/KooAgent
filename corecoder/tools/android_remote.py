"""Optional adapter for calling Operit Android Runtime tools over HTTP."""

import json
import urllib.error
import urllib.request

from .base import Tool


class AndroidRemoteTool(Tool):
    name = "android_list_installed_apps"
    description = "List installed Android apps by calling an Operit Android Runtime over HTTP."
    parameters = {
        "type": "object",
        "properties": {},
        "required": [],
    }

    def __init__(
        self,
        base_url: str,
        bearer_token: str,
        timeout: float = 15.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.timeout = timeout

    def execute(self) -> str:
        payload = {
            "toolName": "list_installed_apps",
            "arguments": {},
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
            return f"Error calling Android Runtime: HTTP {e.code}: {error_body}"
        except urllib.error.URLError as e:
            return f"Error calling Android Runtime: {e.reason}"
        except TimeoutError:
            return "Error calling Android Runtime: timed out"

        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError:
            return f"Error calling Android Runtime: invalid JSON response: {response_body}"

        if not parsed.get("success", False):
            return f"Error from Android Runtime: {parsed.get('error') or 'unknown error'}"

        return str(parsed.get("resultText") or "")
