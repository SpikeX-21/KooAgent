
# Remote Tool API 与最小 Server Agent Loop 设计文档

> 目标周期：2026-07-11 到 2026-07-25  
> Android 源码位置：`/Users/spike21/workspace/code/Operit`  
> 本文目标：指导最小化修改当前 Android 代码，使服务端 Agent Harness 能通过 HTTP 调用 Android Runtime 中已有工具，跑通 `server harness -> Android runtime -> tool result -> server loop` 闭环。

## 1. 设计目标

本阶段只做一件事：

> 在 Operit Android 侧新增 Remote Tool API，让服务端最小 Agent Loop 可以通过 HTTP 下发结构化工具调用，并拿到结构化工具结果。

成功后的端到端链路：

```text
Server Agent Loop
  -> POST /api/device/tool-call
  -> ExternalChatHttpServer
  -> RemoteToolApiHandler
  -> AIToolHandler.executeTool(...)
  -> Android device tool
  -> ToolResult JSON
  -> Server Agent Loop 下一轮
```

## 2. 非目标

本阶段不要做这些：

- 不改 Operit 现有聊天 Agent Loop。
- 不把服务端 Agent 嵌入 Android。
- 不做 Web 控制台。
- 不做多设备调度。
- 不做完整权限后台。
- 不做 streaming tool-call。
- 不做云手机集群能力。
- 不重写 Android 工具实现。

本阶段的关键原则是：

> Android 只新增一个稳定的远程工具执行入口，服务端 Agent Loop 自己管理任务状态和上下文。

## 3. 现有源码落点

### 3.1 HTTP 服务入口

文件：

```text
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/integrations/http/ExternalChatHttpServer.kt
```

已确认能力：

- 使用 `NanoHTTPD` 提供 HTTP 服务。
- 监听 `0.0.0.0` 和配置端口，默认端口来自 `ExternalHttpApiPreferences`。
- 已有 Bearer Token 鉴权。
- 已有 CORS。
- 已有 JSON 响应工具函数。
- 已有 `/api/health` 和 `/api/external-chat`。

设计决策：

> 复用 `ExternalChatHttpServer`，新增 `/api/device/*` 路由，不另起 HTTP Server。

原因：

- 最小改动。
- 复用现有外部调用开关、端口、Token 和服务生命周期。
- 避免新增前台服务和配置页。

### 3.2 工具执行入口

文件：

```text
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/core/tools/AIToolHandler.kt
```

关键类型和函数：

```kotlin
AIToolHandler.getInstance(context)
AIToolHandler.registerDefaultTools()
AIToolHandler.executeTool(tool: AITool): ToolResult
AIToolHandler.executeToolAndStream(tool: AITool): Flow<ToolResult>
AIToolHandler.getAllToolNames()
```

本阶段使用：

```kotlin
AIToolHandler.executeTool(...)
```

暂不使用：

```kotlin
executeToolAndStream(...)
```

原因：

- 第一阶段只需同步工具调用。
- 同步结果更容易写 trace 和 server loop。
- streaming 工具可以作为后续扩展。

### 3.3 工具数据模型

文件：

```text
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/data/model/AITool.kt
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/core/tools/ToolResultDataClasses.kt
```

现有模型：

```kotlin
@Serializable
data class ToolParameter(val name: String, val value: String)

@Serializable
data class AITool(
    val name: String,
    val parameters: List<ToolParameter> = emptyList(),
    val description: String = ""
)

@Serializable
data class ToolResult(
    val toolName: String,
    val success: Boolean,
    val result: ToolResultData,
    val error: String? = null
)
```

`ToolResultData` 已支持：

```kotlin
fun toJson(): String
override fun toString(): String
```

设计决策：

> Remote API 不直接暴露 Kotlin 的多态序列化对象，而是返回 `result_text` 和 `result_json` 两种形式。

原因：

- 服务端第一阶段不需要理解所有 Android 侧 result data class。
- `result_text` 适合模型上下文。
- `result_json` 适合后续结构化 trace。

### 3.4 第一阶段可用工具

从 `ToolRegistration.kt` 已确认这些工具存在：

```text
capture_screenshot
get_page_info
tap
set_input_text
swipe
press_key
start_app
list_installed_apps
execute_shell
```

第一阶段推荐暴露给服务端 Agent 的工具：

```text
capture_screenshot
get_page_info
tap
set_input_text
swipe
press_key
start_app
execute_shell
```

建议暂不暴露：

```text
run_ui_subagent
execute_in_terminal_session_streaming
ffmpeg_execute
任意 package / MCP 工具
```

原因：

- 第一阶段要证明端云工具调用闭环，不要引入子 Agent 和流式终端复杂度。
- 高风险工具需要后续权限策略。

## 4. Android 侧改造设计

### 4.1 新增文件

建议新增：

```text
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/integrations/http/RemoteToolApiModels.kt
/Users/spike21/workspace/code/kooagent/Operit/app/src/main/java/com/ai/assistance/operit/integrations/http/RemoteToolApiHandler.kt
```

职责：

- `RemoteToolApiModels.kt`：定义 HTTP request / response DTO。
- `RemoteToolApiHandler.kt`：处理 `/api/device/*` 路由，转换 JSON 到 `AITool`，执行工具，转换结果。

不要把所有逻辑塞进 `ExternalChatHttpServer.kt`。

### 4.2 新增 HTTP 路由

在 `ExternalChatHttpServer.serve(...)` 中新增分支：

```kotlin
session.uri == DEVICE_HEALTH_PATH && session.method == Method.GET ->
    remoteToolApiHandler.handleDeviceHealth(session)

session.uri == DEVICE_TOOLS_PATH && session.method == Method.GET ->
    remoteToolApiHandler.handleListTools(session)

session.uri == DEVICE_TOOL_CALL_PATH && session.method == Method.POST ->
    remoteToolApiHandler.handleToolCall(session)
```

建议 endpoint：

```text
GET  /api/device/health
GET  /api/device/tools
POST /api/device/tool-call
```

暂不设计：

```text
POST /api/device/tool-stream
POST /api/device/session/cancel
POST /api/device/batch-tool-call
```

### 4.3 鉴权策略

第一阶段复用现有 Bearer Token。

所有 `/api/device/*` 端点必须经过：

```kotlin
requireBearerToken(session)
```

如果 `requireBearerToken` 当前是 `ExternalChatHttpServer` 私有方法，有两种实现方式：

方案 A：让 `ExternalChatHttpServer` 先鉴权，再调用 handler。

```kotlin
val unauthorized = requireBearerToken(session)
if (unauthorized != null) return unauthorized
return remoteToolApiHandler.handleToolCall(session)
```

方案 B：抽一个 `HttpAuthHelper`。

第一阶段推荐方案 A，改动更小。

### 4.4 Request / Response DTO

#### RemoteToolCallRequest

```kotlin
@Serializable
data class RemoteToolCallRequest(
    val requestId: String? = null,
    val taskId: String? = null,
    val stepIndex: Int? = null,
    val toolName: String,
    val arguments: Map<String, String> = emptyMap(),
    val timeoutMs: Long? = null,
    val trace: Boolean = true
)
```

设计说明：

- `requestId`：服务端调用 ID。
- `taskId`：服务端任务 ID，Android 不负责解释，只回传。
- `stepIndex`：服务端 loop 步数，Android 不负责解释，只回传。
- `toolName`：对应 Operit 内部工具名。
- `arguments`：第一阶段统一为 `Map<String, String>`，直接转成 `ToolParameter`。
- `timeoutMs`：第一阶段可保留字段，但 Android 侧可先不强制实现。
- `trace`：预留字段。

#### RemoteToolCallResponse

```kotlin
@Serializable
data class RemoteToolCallResponse(
    val requestId: String? = null,
    val taskId: String? = null,
    val stepIndex: Int? = null,
    val toolName: String,
    val success: Boolean,
    val resultText: String,
    val resultJson: String? = null,
    val error: String? = null,
    val startedAtMs: Long,
    val finishedAtMs: Long,
    val latencyMs: Long
)
```

设计说明：

- `resultText = toolResult.result.toString()`，用于模型上下文。
- `resultJson = toolResult.result.toJson()`，用于服务端 trace。
- `latencyMs` 用于后续评测。

#### RemoteToolListResponse

```kotlin
@Serializable
data class RemoteToolListResponse(
    val success: Boolean,
    val tools: List<String>,
    val allowlist: List<String>,
    val error: String? = null
)
```

### 4.5 工具 allowlist

第一阶段必须做 allowlist，避免服务端任意调用所有 Android 工具。

建议在 `RemoteToolApiHandler` 中硬编码第一版：

```kotlin
private val remoteToolAllowlist = setOf(
    "capture_screenshot",
    "get_page_info",
    "tap",
    "set_input_text",
    "swipe",
    "press_key",
    "start_app",
    "execute_shell"
)
```

注意：

- 这不是最终权限系统。
- 最终权限系统应该进入 Server Policy Engine。
- Android 侧 allowlist 是安全底线。

### 4.6 ToolCall 到 AITool 转换

转换逻辑：

```kotlin
val tool = AITool(
    name = request.toolName,
    parameters = request.arguments.map { (key, value) ->
        ToolParameter(name = key, value = value)
    }
)
```

然后执行：

```kotlin
val handler = AIToolHandler.getInstance(appContext)
handler.registerDefaultTools()
val result = withContext(Dispatchers.IO) {
    handler.executeTool(tool)
}
```

注意：

- `registerDefaultTools()` 是幂等的。
- 工具执行放到 `Dispatchers.IO`。
- HTTP 线程不要直接执行重工具。

### 4.7 错误处理

错误分层：

```text
400 Bad Request
  - body 为空
  - JSON 解析失败
  - toolName 为空
  - arguments 类型不对

401 Unauthorized
  - Bearer Token 错误

403 Forbidden
  - toolName 不在 remote allowlist

500 Internal Server Error
  - 工具执行抛异常
```

工具自身失败不要返回 HTTP 500，而是返回 200 + `success=false`：

```json
{
  "success": false,
  "toolName": "tap",
  "resultText": "",
  "error": "Invalid parameters: x is required"
}
```

只有 handler 自身异常才返回 HTTP 500。

### 4.8 请求示例

#### health

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://DEVICE_IP:8094/api/device/health"
```

响应：

```json
{
  "success": true,
  "status": "ok",
  "deviceRuntime": "android",
  "timestampMs": 1720000000000
}
```

#### screenshot

```bash
curl -X POST "http://DEVICE_IP:8094/api/device/tool-call" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "requestId": "req_001",
    "taskId": "task_001",
    "stepIndex": 1,
    "toolName": "capture_screenshot",
    "arguments": {}
  }'
```

响应：

```json
{
  "requestId": "req_001",
  "taskId": "task_001",
  "stepIndex": 1,
  "toolName": "capture_screenshot",
  "success": true,
  "resultText": "/storage/emulated/0/Android/data/xxx/screenshot.png",
  "resultJson": "{\"__type\":\"StringResultData\",\"value\":\"...\"}",
  "error": null,
  "startedAtMs": 1720000000000,
  "finishedAtMs": 1720000000200,
  "latencyMs": 200
}
```

#### tap

```bash
curl -X POST "http://DEVICE_IP:8094/api/device/tool-call" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "requestId": "req_002",
    "taskId": "task_001",
    "stepIndex": 2,
    "toolName": "tap",
    "arguments": {
      "x": "540",
      "y": "1200"
    }
  }'
```

#### input

```bash
curl -X POST "http://DEVICE_IP:8094/api/device/tool-call" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "requestId": "req_003",
    "taskId": "task_001",
    "stepIndex": 3,
    "toolName": "set_input_text",
    "arguments": {
      "text": "hello world"
    }
  }'
```

#### back

```bash
curl -X POST "http://DEVICE_IP:8094/api/device/tool-call" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "toolName": "press_key",
    "arguments": {
      "key_code": "KEYCODE_BACK"
    }
  }'
```

## 5. Server 侧最小 Agent Loop 设计

本阶段 Server 只需要证明 loop 能调用 Android 工具，不要做完整产品服务。

### 5.1 推荐目录

建议新建独立服务端目录，不放进 Android 工程：

```text
server-harness/
  package.json
  src/
    index.ts
    agentLoop.ts
    androidDeviceClient.ts
    toolRegistry.ts
    traceStore.ts
    types.ts
  traces/
```

### 5.2 Server 模块

#### AndroidDeviceClient

职责：

- 封装 HTTP 调用 Android `/api/device/tool-call`。
- 自动带 Bearer Token。
- 统一处理超时和错误。

接口：

```ts
type DeviceToolCall = {
  requestId: string
  taskId: string
  stepIndex: number
  toolName: string
  arguments: Record<string, string>
}

async function callTool(call: DeviceToolCall): Promise<DeviceToolResult>
```

#### ToolRegistry

职责：

- 定义服务端模型可见工具 schema。
- 第一阶段工具列表与 Android allowlist 对齐。

第一阶段工具：

```ts
capture_screenshot
get_page_info
tap
type_text -> 映射到 Android set_input_text
swipe
back -> 映射到 Android press_key KEYCODE_BACK
home -> 映射到 Android press_key KEYCODE_HOME
start_app
execute_shell
```

注意：

> Server 工具名可以更语义化，但发给 Android 前必须映射到真实 Operit 工具名。

#### TraceStore

职责：

- 每一步写 JSONL。

最小 trace event：

```json
{
  "taskId": "task_001",
  "stepIndex": 1,
  "event": "tool_result",
  "toolName": "capture_screenshot",
  "success": true,
  "latencyMs": 200,
  "timestamp": "2026-07-11T10:00:00.000Z"
}
```

### 5.3 最小 Agent Loop

第一阶段可以先做半自动 loop：

```text
用户输入任务
  -> Server 调模型
  -> 模型输出 JSON tool_call
  -> Server 校验 tool_call
  -> AndroidDeviceClient.callTool(...)
  -> 记录 trace
  -> 把 tool_result 放回下一轮上下文
  -> 直到模型输出 final_answer 或达到 max_steps
```

最小 loop 伪代码：

```ts
async function runTask(goal: string) {
  const taskId = createTaskId()
  const messages = [
    { role: "system", content: buildSystemPrompt(toolRegistry) },
    { role: "user", content: goal }
  ]

  for (let stepIndex = 1; stepIndex <= MAX_STEPS; stepIndex++) {
    const modelOutput = await callModel(messages)
    trace.write({ taskId, stepIndex, event: "model_output", modelOutput })

    const action = parseModelAction(modelOutput)

    if (action.type === "final_answer") {
      trace.write({ taskId, stepIndex, event: "final_answer", answer: action.answer })
      return action.answer
    }

    const deviceCall = mapModelToolToDeviceTool({
      taskId,
      stepIndex,
      action
    })

    const result = await androidDeviceClient.callTool(deviceCall)
    trace.write({ taskId, stepIndex, event: "tool_result", result })

    messages.push({
      role: "user",
      content: buildToolResultMessage(result)
    })
  }

  return "Task stopped: max steps reached"
}
```

### 5.4 第一阶段模型输出协议

为了降低解析风险，先要求模型输出 JSON，不做 XML。

工具调用：

```json
{
  "type": "tool_call",
  "tool_name": "tap",
  "arguments": {
    "x": "540",
    "y": "1200"
  },
  "reason": "点击搜索框"
}
```

最终回答：

```json
{
  "type": "final_answer",
  "answer": "已完成"
}
```

如果模型输出无法解析：

- 记录 `parse_error`。
- 注入错误消息让模型重试一次。
- 连续 2 次解析失败则停止。

## 6. 上下文最小版本

本阶段上下文只包含：

```text
system prompt
user goal
available tools
last screenshot result
last page info result
last tool result
step index
```

不要在 7.11-7.25 阶段接入 LLM-wiki 记忆。

LLM-wiki 记忆放到下一阶段：

```text
7.26 - 8.10: trajectory -> task memory -> retrieval -> context injection
```

## 7. 设备连接方式

### 7.1 同一局域网

```text
Server -> http://ANDROID_IP:8094/api/device/tool-call
```

### 7.2 USB ADB forward

如果局域网不稳定，使用：

```bash
adb forward tcp:8094 tcp:8094
```

Server 调用：

```text
http://127.0.0.1:8094/api/device/tool-call
```

## 8. 实施顺序

### Step 1：Android 新增 DTO

新增：

```text
RemoteToolApiModels.kt
```

包含：

- `RemoteToolCallRequest`
- `RemoteToolCallResponse`
- `RemoteToolListResponse`
- `RemoteDeviceHealthResponse`

### Step 2：Android 新增 Handler

新增：

```text
RemoteToolApiHandler.kt
```

包含：

- `handleDeviceHealth(session)`
- `handleListTools(session)`
- `handleToolCall(session)`
- `toAITool(request)`
- `toRemoteResponse(request, toolResult, timings)`

### Step 3：接入 ExternalChatHttpServer

修改：

```text
ExternalChatHttpServer.kt
```

新增：

- `private val remoteToolApiHandler = RemoteToolApiHandler(appContext)`
- `/api/device/health`
- `/api/device/tools`
- `/api/device/tool-call`

### Step 4：手动 curl 验证

必须验证：

- health 成功。
- tools 返回 allowlist。
- capture_screenshot 成功。
- tap 成功。
- set_input_text 成功。
- press_key BACK 成功。
- 非 allowlist 工具返回 403。
- 错误 token 返回 401。

### Step 5：Server AndroidDeviceClient

实现：

- `callTool(...)`
- 超时控制
- 错误分类
- trace 写入

### Step 6：最小 Agent Loop

实现：

- max steps
- model JSON 输出解析
- tool name 映射
- tool result 回填
- final answer
- trace JSONL

## 9. 验收标准

### 9.1 Android Runtime 验收

满足：

- 可以通过 HTTP 调用 `capture_screenshot`。
- 可以通过 HTTP 调用 `tap`。
- 可以通过 HTTP 调用 `set_input_text`。
- 可以通过 HTTP 调用 `swipe`。
- 可以通过 HTTP 调用 `press_key`。
- 返回包含 `success / resultText / resultJson / latencyMs / error`。
- 未授权请求被拒绝。
- 非 allowlist 工具被拒绝。

### 9.2 Server Harness 验收

满足：

- 输入一个自然语言任务。
- Server 至少能连续执行 3 步工具调用。
- 每一步写 trace。
- 达到 `final_answer` 或 `max_steps` 能停止。
- 工具失败不会导致 server 崩溃。

### 9.3 闭环验收场景

建议第一条闭环任务：

```text
打开指定 App，截图，点击某个坐标，输入一段文本，然后返回。
```

对应工具序列：

```text
start_app
capture_screenshot
tap
set_input_text
press_key(KEYCODE_BACK)
capture_screenshot
final_answer
```

## 10. 风险与处理

### 10.1 工具权限弹窗阻塞

风险：

Android 工具权限可能要求用户确认。

处理：

- 开发阶段将目标工具设置为允许。
- 第一阶段文档记录需要的权限配置。
- 后续 Server Policy Engine 再管理权限。

### 10.2 UI 工具需要前台服务或无障碍权限

风险：

截图、点击、输入依赖 Android 权限状态。

处理：

- health 响应中后续可加入 permission summary。
- 第一阶段先人工确认权限开启。

### 10.3 `ToolResultData` 多态 JSON 服务端不好解析

处理：

- 第一阶段服务端只依赖 `resultText`。
- `resultJson` 只写入 trace。

### 10.4 长工具阻塞 HTTP 请求

处理：

- 第一阶段 allowlist 只选短工具。
- 单次调用设置 server 侧 timeout。
- Android 侧预留 `timeoutMs` 字段，后续再实现。

## 11. 后续扩展

第一阶段完成后再考虑：

- `/api/device/tool-stream`
- `/api/device/session/cancel`
- 权限摘要接口
- 设备状态接口
- screenshot 文件 HTTP 访问接口
- Server Policy Engine
- LLM-wiki 任务记忆
- Eval runner
- Web 控制台

## 12. 给 AI Coding Agent 的实施提示

如果让 AI 直接修改 Operit，请按这个顺序给任务：

1. 阅读 `ExternalChatHttpServer.kt`，确认现有 JSON response、CORS、Bearer Token、read body 工具函数。
2. 阅读 `AIToolHandler.kt` 和 `AITool.kt`，确认 `AITool` 与 `ToolResult` 数据结构。
3. 新增 `RemoteToolApiModels.kt`。
4. 新增 `RemoteToolApiHandler.kt`。
5. 在 `ExternalChatHttpServer.serve(...)` 中接入 `/api/device/*`。
6. 编译修复 import / serialization 问题。
7. 用 curl 验证 3 个工具：`capture_screenshot`、`tap`、`press_key`。

不要让 AI 同时修改 Agent Loop、Web UI、权限页面和服务端。一次只做 Remote Tool API。
