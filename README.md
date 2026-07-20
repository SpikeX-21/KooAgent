# KooAgent

KooAgent 是一个以 **pi-agent 为主 Agent**、以 Operit 为 Android 远程工具运行态的集成仓库。

pi-agent 负责理解任务、选择工具、安排执行顺序、处理失败并继续推理；在 **Remote Tool API v2 集成路径**中，Operit 不承担远程 Agent 调度，只在 Android 设备上执行被批准的原子工具，并返回可关联、可追踪的结构化结果。

```text
用户任务
  -> pi-agent（规划、tool call、错误恢复）
  -> KooAgent Operit Extension（协议适配、结果映射、trace）
  -> Operit Remote Tool API v2
  -> Android 运行态（27 个原子工具）
  -> v2 structured outcome
  -> pi-agent ToolResultMessage
  -> LLM 决定下一步或输出最终答复
```

## 职责边界

| 组件 | 职责 |
| --- | --- |
| `pi/` | 主 Agent：模型调用、工具选择、并发与顺序控制、失败后的继续规划。KooAgent 不修改 pi 源码。 |
| `.pi/extensions/kooagent-operit/` | 将 Pi 的 `android_*` 工具适配为 Operit Remote Tool API v2；生成 trace 上下文、校验回包、映射 `content` / `details` / `isError`。 |
| `Operit/` | Android 远程执行器：校验 27 个工具的 allowlist 和参数、执行原子工具、维护执行状态与取消请求、返回结构化 outcome。 |

`android_run_ui_subagent` / `run_ui_subagent` 被刻意排除：子 Agent 编排属于 pi-agent，而不是设备端运行态。

## 当前能力

- 27 个 `android_*` 原子工具通过项目内 Pi extension 自动注册。
- 采用未发布即升级的 Remote Tool API v2，不保留 v1 兼容逻辑。
- 每次调用都带有 `sessionId`、`runId`、`turnIndex`、`traceId`、`toolCallId`、`executionId`、`attempt`，可贯穿 Pi 会话与 Android 执行。
- Operit 支持幂等执行、执行状态查询和取消请求。
- 扩展对回包关联字段、工具名和协议版本进行校验；传输/协议异常也归一为工具结果。
- 只对可重试 `UNAVAILABLE` 的安全读操作和带幂等键的写操作执行有限重试；危险设备写操作保持顺序执行且不自动重试。
- 可配置 JSONL trace，且默认不记录工具参数、完整结果或图片数据。

## 工具结果如何回到模型

Operit 为每次已接受调用返回 `RemoteToolOutcomeV2`：

```ts
{
  protocolVersion: 2,
  trace: { /* session/run/trace/tool-call/execution/attempt IDs */ },
  toolName: "list_installed_apps",
  status: "SUCCEEDED" | "FAILED" | "REJECTED" | "TIMED_OUT" | "CANCELLED" | "UNAVAILABLE",
  content: [/* text / image / artifact */],
  data: {/* 可选结构化数据 */},
  error: {/* 可选 code/category/retryable/userActionRequired/message */},
  timing: {/* accepted/started/finished/duration */},
  runtime: {/* Android runtime metadata */}
}
```

Extension 将它映射为 Pi 的 `AgentToolResult` / `ToolResultMessage`：

- `content` 是唯一送回 LLM 的结果内容。
- `details` 保留有大小约束的 outcome，服务于 UI、日志与 trace，不作为模型上下文；过大的 `data` 会被省略并标记该省略。
- 任意非 `SUCCEEDED` 状态都会设置 `isError: true`。
- 失败时，`content` 会首先包含紧凑的 `[OPERIT_TOOL_ERROR]` 摘要（状态、错误码、类别、是否可重试、是否需要用户操作、消息），随后保留工具原始内容。这样 LLM 无需读取 `details` 也能选择恢复动作。

## 快速开始

### 1. 准备 Android 运行态

在手机上安装并打开 Operit，启用外部 HTTP 调用能力。通过 USB 连接时转发端口：

```bash
adb forward tcp:8094 tcp:8094
```

如需覆盖项目本地连接配置，使用环境变量（不要将 token 提交到仓库）：

```bash
export OPERIT_URL="http://127.0.0.1:8094"
export OPERIT_TOKEN="<token shown by Operit>"
export OPERIT_TIMEOUT_MS="15000"
export OPERIT_TRACE_FILE="/tmp/operit-trace.jsonl" # 可选
```

检查连接：

```bash
curl -H "Authorization: Bearer ${OPERIT_TOKEN}" \
  "${OPERIT_URL}/api/device/health"
```

### 2. 启动 pi-agent

在仓库根目录运行：

```bash
./pi/pi-test.sh
```

首次运行时允许 Pi 信任该项目，使其加载 `.pi/extensions/kooagent-operit`。启动后可执行：

```text
/operit-status
```

该命令只检查 Operit 连通性；正常对话中由 pi-agent 决定何时调用 `android_*` 工具。

## Remote Tool API v2

设备端端点如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/device/health` | 健康与协议版本检查。 |
| `GET` | `/api/device/tools` | 获取当前允许的 27 个工具。 |
| `POST` | `/api/device/tool-call` | 提交一次 v2 工具执行。 |
| `GET` | `/api/device/tool-executions/{executionId}` | 查询执行状态或复用后的结果。 |
| `DELETE` | `/api/device/tool-executions/{executionId}` | 请求取消正在执行的任务。 |

所有设备端点都需要现有的 Bearer Token。详细请求/响应契约见 [Operit Remote Tool API v2 实现说明](Operit/docs/remote_tool_api_v2_implementation.md)。

## 验证与文档

- Extension 测试：

  ```bash
  ./pi/node_modules/.bin/tsx --test .pi/extensions/kooagent-operit/test/*.test.ts
  ```

- [端到端测试报告（默认 `kimi-k2.5`）](Operit/docs/reports/2026-07-21-kimi-k25-full-e2e.md)
- [多工具执行报告](Operit/docs/reports/2026-07-21-llm-multitool-e2e.md)
- [架构与执行闭环](remote-tool-api-and-minimal-agent-loop.md)
- [Android 设备调试指南](Operit/docs/remote_tool_corecoder_debug.md)
- [Extension 配置与策略](.pi/extensions/kooagent-operit/README.md)

## 开发约束

- 不修改 pi-agent 源码；边界适配只放在项目内 Extension 与 Operit HTTP 层。
- 在 Remote Tool API v2 集成路径中，Operit 只做运行态工具执行，不做远程 Agent 规划或调度。
- 新增工具时，先明确其幂等性、并发策略、重试语义、权限边界与结果映射，再加入 27 工具 allowlist。
- Trace 应只记录关联 ID、状态、错误码与耗时等最小可观测信息，避免写入敏感参数或大结果。
