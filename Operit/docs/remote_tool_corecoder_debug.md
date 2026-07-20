# Remote Tool API v2 调试

Operit 的 Remote Tool API 是 Android 运行态执行器。Agent 调度、错误恢复和重试策略由 pi extension 负责；Operit 只校验并执行 allowlist 中的 27 个工具。

## 端点

- `GET /api/device/health`：运行态健康检查。
- `GET /api/device/tools`：已注册工具和远程 allowlist。
- `POST /api/device/tool-call`：提交一次协议 v2 工具执行。
- `GET /api/device/tool-executions/{executionId}`：查询执行状态或最终结果。
- `DELETE /api/device/tool-executions/{executionId}`：请求取消执行。

请求仍使用已有的 HTTP 鉴权方式。协议不再接受 v1 的 `requestId`、字符串参数表或 `resultText/resultJson` 字段。

## 最小请求

```json
{
  "protocolVersion": 2,
  "trace": {
    "sessionId": "session-1",
    "runId": "run-1",
    "turnIndex": 0,
    "traceId": "0123456789abcdef",
    "toolCallId": "tool-call-1",
    "executionId": "018f0000-0000-7000-8000-000000000001",
    "attempt": 1
  },
  "toolName": "list_installed_apps",
  "arguments": {
    "include_system": false
  },
  "timeoutMs": 30000
}
```

`arguments` 是类型化 JSON 对象，不需要把布尔值、数字或嵌套结构预先转成字符串。`executionId` 是幂等键：完全相同的请求会复用执行；相同 ID 对应不同请求会得到 `EXECUTION_ID_CONFLICT`。

## 最小结果

```json
{
  "protocolVersion": 2,
  "trace": {
    "sessionId": "session-1",
    "runId": "run-1",
    "turnIndex": 0,
    "traceId": "0123456789abcdef",
    "toolCallId": "tool-call-1",
    "executionId": "018f0000-0000-7000-8000-000000000001",
    "attempt": 1
  },
  "toolName": "list_installed_apps",
  "status": "SUCCEEDED",
  "content": [
    { "type": "text", "text": "..." }
  ],
  "data": {},
  "error": null,
  "timing": {
    "acceptedAtMs": 0,
    "startedAtMs": 0,
    "finishedAtMs": 1,
    "durationMs": 1
  },
  "runtime": {
    "runtimeId": "operit-android",
    "deviceRuntime": "android",
    "appVersion": "..."
  }
}
```

`content` 是给模型看的内容，支持 `text`、`image`、`artifact` 三种判别联合；`data` 是 UI/日志使用的结构化数据。失败也返回同一个 outcome 结构，通过 `status` 和结构化 `error` 表达，不依赖 HTTP 文本或异常消息判断。

## 状态与取消

查询返回 `RUNNING`、`CANCELLATION_REQUESTED` 或最终 outcome 的状态。取消是请求式取消：服务端会中断当前执行线程；工具是否能立即停止取决于底层执行器是否响应中断。客户端超时后应先查询状态，不应盲目重复副作用工具。

## 当前边界

- allowlist 固定为 27 个工具。
- `run_ui_subagent` 不在协议中；Agent 编排只在 pi-agent 一侧进行。
- Operit 的远程路径直接调用工具 executor，不执行 Operit 内部 Agent hook 或自动工具调度。
