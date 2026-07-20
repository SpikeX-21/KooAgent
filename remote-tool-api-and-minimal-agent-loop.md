# Operit Remote Tool API v2 与 pi-agent 执行闭环

## 决策

项目未发布，因此直接使用协议 v2，不保留 v1 字段、兼容分支或回退逻辑。pi 源码不修改，边界适配全部位于 `.pi/extensions/kooagent-operit` 和 Operit HTTP 层。

职责划分如下：

- pi-agent：选择工具、并发控制、错误恢复、有限重试、把结果写入 `ToolResultMessage`。
- kooagent-operit extension：协议转换、trace 上下文、结果映射、传输错误归一化。
- Operit：校验 allowlist 和参数、执行 Android 工具、返回结构化 outcome、保存短期执行状态。

Operit 不再承担远程 Agent 调度。`run_ui_subagent` 被排除，目前暴露 27 个原子工具。

## 请求契约

`POST /api/device/tool-call` 接受：

```ts
interface RemoteToolRequestV2 {
  protocolVersion: 2;
  trace: {
    sessionId: string;
    runId: string;
    turnIndex: number;
    traceId: string;
    toolCallId: string;
    executionId: string;
    attempt: number;
  };
  toolName: string;
  arguments: Record<string, JsonValue>;
  timeoutMs: number;
}
```

`arguments` 保留 JSON 类型。`executionId` 同时用于幂等、状态查询、取消以及跨端 trace 关联。

## 结果契约

所有已接受执行都归一成同一个 outcome：

```ts
interface RemoteToolOutcomeV2 {
  protocolVersion: 2;
  trace: RemoteTraceContext;
  toolName: string;
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "REJECTED"
    | "TIMED_OUT"
    | "CANCELLED"
    | "UNAVAILABLE";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "artifact"; artifactId: string; mimeType: string; size: number; sha256: string }
  >;
  data?: JsonValue;
  error?: {
    code: string;
    category:
      | "INVALID_REQUEST"
      | "PERMISSION"
      | "NOT_FOUND"
      | "PRECONDITION"
      | "CONFLICT"
      | "TIMEOUT"
      | "CANCELLED"
      | "UNAVAILABLE"
      | "EXECUTION"
      | "INTERNAL";
    message: string;
    retryable: boolean;
    userActionRequired: boolean;
    data?: JsonValue;
  };
  timing: {
    acceptedAtMs: number;
    startedAtMs: number;
    finishedAtMs: number;
    durationMs: number;
  };
  runtime: {
    runtimeId: string;
    deviceRuntime: string;
    appVersion: string;
  };
}
```

`content` 对齐 Pi 的 `AgentToolResult.content`；完整且有大小上限的 outcome 放入 `details`，供日志/UI/trace 使用。非成功状态由 extension 的 `tool_result` hook 设置 `isError = true`，不修改 Pi 内部实现。

## 执行语义

1. Extension 为每次工具调用生成 `executionId`，并传递 session/run/turn/trace/toolCall 关联字段。
2. Operit 只允许固定 27 个工具，直接取得 executor、校验参数并执行，不进入 Operit 的 Agent hook 和自动 package 调度。
3. 相同 `executionId` 与完全相同请求复用原执行；不同请求复用该 ID 会被拒绝。
4. Extension 校验响应中的工具名和全部关联字段，避免串线结果进入错误的 Pi tool call。
5. 仅当结果为可重试的 `UNAVAILABLE` 时，安全读或带幂等键的写操作才能在策略上重试；不安全写操作不重试，并受每个 agent run 的总重试预算约束。
6. 客户端超时会先查询 `GET /api/device/tool-executions/{executionId}`；AbortSignal 会调用对应的 DELETE 端点请求取消。

## Trace

如配置 `OPERIT_TRACE_FILE`，extension 追加 JSONL 完成事件。事件只记录关联 ID、状态、错误码、耗时、运行态和传输尝试次数，不记录参数、完整结果或图片数据。这样可以用 `traceId -> toolCallId -> executionId` 贯穿 Pi 会话和 Android 执行，同时控制敏感信息与日志体积。

## 端点

- `GET /api/device/health`
- `GET /api/device/tools`
- `POST /api/device/tool-call`
- `GET /api/device/tool-executions/{executionId}`
- `DELETE /api/device/tool-executions/{executionId}`

更具体的调试请求和响应见 `Operit/docs/remote_tool_corecoder_debug.md`。
