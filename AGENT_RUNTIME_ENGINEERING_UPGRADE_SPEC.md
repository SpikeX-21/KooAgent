# KooAgent Agent Runtime 工程化升级规格

状态：`ready-for-agent`（本地规格）  
范围：CoreCoder Agent 层 + Operit 工具执行态 + Remote Tool API 跨仓库契约

## Problem Statement

KooAgent 已验证“CoreCoder Agent 大脑 -> Remote Tool API -> Operit Android 工具执行态”的最小真实链路，也已经具备工具注册、远程 allowlist、基础参数绑定、并行调用、最大轮次、权限控制和 JSONL trace 等能力。

当前最需要解决的问题不是继续增加工具数量，而是把分散在两端的失败处理、安全控制、循环终止和可观测能力收敛成稳定契约。否则，同一种失败可能在 Operit 中表现为 HTTP 状态、`ToolResult.error` 或异常，在 CoreCoder 中又被压成普通字符串；Agent 无法可靠判断应该自动重试、修正参数、重新规划、请求授权还是立即停止。随着远程工具数量和副作用工具增加，这会放大为重复调用、无效 Token 消耗、越权执行、并发冲突和难以复现的问题。

项目需要形成一套职责明确的运行模型：CoreCoder 负责规划、工具选择、Agent loop、失败恢复和停止决策；Operit 负责工具目录、执行前 Gate、Android 运行态执行、资源隔离和结构化结果；Remote Tool API 负责把两端连接为可版本化、可测试、可观测的协议。

## Solution

建立统一的 Tool Runtime Contract，并围绕它完成三层治理：

1. Operit 在执行前依次完成协议解析、Schema、权限、策略和业务预条件 Gate，在执行中提供 timeout、取消、并发控制、幂等和有限的瞬时故障重试，在执行后返回统一的结构化结果。
2. CoreCoder 根据结构化结果执行确定性的恢复策略：系统可恢复的错误由运行时自动重试；参数或工具选择错误交给模型修正或重新规划；授权和确认交给用户；不可恢复错误终止当前路径。Agent loop 同时受轮次、时间、失败次数、重复调用和无进展检测约束。
3. 两端共享版本化错误分类、工具元数据和 trace 关联字段，并以契约测试和真实设备 golden test 验证端到端行为。

建议按以下优先级交付：

- **P0：稳定契约与停止能力。** 统一 Tool Call/Result/Error、错误分类、timeout、Agent loop budget、重复调用熔断和 trace 关联。
- **P1：安全与调度。** 完成 Schema/权限/预条件/策略 Gate，基于工具元数据进行安全并行、重试、幂等、确认和敏感数据治理。
- **P2：规模化工具路由与质量体系。** 把 Operit 已有工具包延迟加载能力通过远程工具目录暴露给 CoreCoder，增加 tool search/package activation，并建立自动化 eval 与 SLO。

## User Stories

1. As a CoreCoder Agent developer, I want every remote tool result to use one versioned schema, so that the Agent can make deterministic recovery decisions.
2. As an Operit runtime developer, I want every execution failure to map to a stable error code, so that transport details and exception text do not become protocol semantics.
3. As an Agent, I want to distinguish retryable transient failures from model-correctable failures, so that I do not waste reasoning rounds on runtime recovery.
4. As an Agent, I want field-level validation errors, so that I can repair only the invalid arguments.
5. As an Agent, I want unknown-tool responses to include safe alternatives or discovery guidance, so that I can select an available tool without guessing.
6. As a user, I want permission and confirmation requirements to be explicit, so that the Agent cannot interpret denial as a generic execution failure.
7. As a user, I want high-risk actions to stop before execution until I confirm them, so that unintended device changes do not occur.
8. As a user, I want sensitive values redacted from model context and traces, so that device data and credentials are not leaked.
9. As a CoreCoder maintainer, I want per-turn limits for rounds, tool calls, elapsed time and consecutive failures, so that every Agent run has a bounded cost.
10. As a CoreCoder maintainer, I want repeated calls identified by tool name and normalized argument fingerprint, so that exact retry loops are stopped early.
11. As a CoreCoder maintainer, I want alternating and no-progress loops detected, so that the Agent cannot evade exact-repeat detection by switching between two actions.
12. As an Agent, I want a structured `LOOP_DETECTED` observation, so that I get one bounded opportunity to replan or ask the user for clarification.
13. As a user, I want the Agent to report why it stopped, so that max budget, denial, cancellation and unrecoverable failure are distinguishable.
14. As an Operit runtime developer, I want every tool to declare timeout and concurrency policy, so that a blocked operation cannot exhaust the runtime.
15. As an Operit runtime developer, I want transient retries to use bounded exponential backoff with jitter, so that temporary network and device failures recover without retry storms.
16. As an Operit runtime developer, I want non-retryable failures excluded from automatic retry, so that invalid or forbidden calls are not repeated.
17. As an Operit runtime developer, I want cancellation to propagate from HTTP request to tool execution where supported, so that abandoned work releases resources.
18. As an Operit runtime developer, I want side-effect tools to accept an idempotency key, so that transport retries do not duplicate an action.
19. As an Agent scheduler, I want tools marked read-only, side-effecting and resource-scoped, so that only independent calls execute concurrently.
20. As an Agent scheduler, I want calls sharing a mutable resource key to be serialized, so that parallel execution does not race on files, apps or UI state.
21. As an Agent, I want a compact searchable remote tool catalog, so that hundreds of tool schemas do not enter every model request.
22. As an Agent, I want package-level discovery and activation, so that only task-relevant Operit tools become visible in the current loop.
23. As an Operit package author, I want tool metadata to describe package, tags, risk, permissions, side effects and examples, so that discovery and policy do not depend on prompt wording.
24. As a platform maintainer, I want role-card access, remote allowlist and user permission decisions evaluated together, so that no exposure path bypasses another policy layer.
25. As a platform maintainer, I want every call correlated by run, task, turn, tool-call and trace identifiers, so that a failure can be followed across CoreCoder and Operit.
26. As an evaluator, I want traces to record normalized argument hash, result summary/hash, latency, retries and stop decision, so that regressions can be measured automatically.
27. As an evaluator, I want deterministic contract tests that do not require an LLM or device, so that protocol regressions fail quickly in CI.
28. As an evaluator, I want scripted Agent-loop scenarios with a fake LLM and fake runtime, so that recovery and loop guards can be tested without model variance.
29. As an evaluator, I want real-device golden tests for representative read-only and side-effect tools, so that Android integration remains proven.
30. As a project owner, I want reliability SLOs for completion, loop termination, unsafe execution and recovery, so that engineering progress is visible beyond anecdotal demos.

## Implementation Decisions

### 1. Ownership boundaries

- CoreCoder owns task planning, model interaction, tool selection, Agent-loop state, recovery policy, loop budgets, stop reasons and final-answer convergence.
- Operit owns the authoritative tool registry, remote exposure policy, input Gate, Android permission checks, tool execution, resource concurrency, cancellation, idempotency support and result redaction.
- The Remote Tool API owns only transport and the versioned contract. It must not hide business failures behind generic HTTP 500 responses or force CoreCoder to parse human-readable strings.
- Operit 内部的 `use_package`、工具包激活与动态注册属于执行态能力；CoreCoder 通过远程目录和激活接口使用这些能力，并决定何时搜索或加载工具。

### 2. P0：统一 Tool Runtime Contract

- 定义版本化 `ToolCallRequest`，至少包含 `protocolVersion`、`requestId`、`runId`、`taskId`、`turnIndex`、`stepIndex`、`toolName`、结构化 `arguments`、可选 `deadlineMs` 和可选 `idempotencyKey`。
- 定义版本化 `ToolCallResult`，至少包含 `success`、`toolName`、`result`、`error`、`retryAdvice`、`startedAt`、`finishedAt`、`latencyMs`、`traceId` 和 `attempt`。
- `error` 使用机器可判定结构：`code`、`category`、`message`、`fieldErrors`、`retryable`、`fatal`、`userActionRequired`、`safeDetails`。异常堆栈只进入受保护日志，不进入模型上下文。
- 首批稳定错误类别为：`INVALID_REQUEST`、`UNKNOWN_TOOL`、`INVALID_ARGUMENTS`、`PERMISSION_REQUIRED`、`PERMISSION_DENIED`、`CONFIRMATION_REQUIRED`、`PRECONDITION_FAILED`、`POLICY_BLOCKED`、`TIMEOUT`、`RATE_LIMITED`、`TRANSIENT_RUNTIME_ERROR`、`CONFLICT`、`CANCELLED`、`EXECUTION_FAILED`、`RESULT_TOO_LARGE` 和 `LOOP_DETECTED`。
- HTTP 状态表达传输/接口层结果，Tool Result 表达工具业务结果。只要请求已被正确解析并形成工具调用结果，客户端不得依赖 HTTP 状态猜测恢复动作。
- CoreCoder 保留兼容旧 Operit 文本结果的适配层，但新 Agent-loop 决策只依赖结构化结果；兼容层在协议稳定后移除。

### 3. P0：确定性恢复策略

- Operit 执行态只对明确标记为 `retryable` 的瞬时错误自动重试，例如连接重置、限流、5xx 或设备资源暂时不可用。重试是重新执行工具，不是把错误先返回给大模型。
- 自动重试采用每工具可配置的最大次数、指数退避、随机抖动和总 deadline；每次 attempt 写 trace。超过预算后只返回一次最终结构化失败。
- `INVALID_ARGUMENTS` 返回字段级错误，由 CoreCoder 把紧凑反馈交给模型进行一次或有限次数参数修正。
- `UNKNOWN_TOOL` 触发工具搜索或重新选择；`PERMISSION_REQUIRED`、`CONFIRMATION_REQUIRED` 触发用户交互；`PRECONDITION_FAILED` 触发补充前置步骤；`fatal=true` 直接终止当前执行路径。
- CoreCoder 为每类错误定义固定 action，不允许仅靠 prompt 自由解释 `retryable`、`fatal` 等字段。

### 4. P0：Agent loop budget 与无进展检测

- 将现有最大轮次扩展为统一 `RunBudget`：最大模型轮次、最大工具调用数、最大连续失败数、单工具最大调用数、最大总耗时，以及可选 Token/费用预算。
- 对每次调用生成 `toolName + canonical JSON arguments` 指纹；相同指纹连续失败或返回相同结果达到阈值时触发熔断。
- 检测 A/B/A/B 交替模式，以及在滑动窗口内“调用变化但结果状态未变化”的无进展模式。
- 远程文件/代码工具的进展信号使用结果摘要、文件状态或 workspace diff；UI 自动化工具的进展信号使用 activity、页面树和可选 screenshot hash。不存在可靠状态探针时退化为调用和结果指纹。
- 首次触发无进展时向模型返回 `LOOP_DETECTED`，要求重新规划、改用工具或向用户澄清；重新规划后仍无进展则停止，并返回稳定 `stopReason`。
- 标准停止原因包括：`FINAL_ANSWER`、`MAX_ROUNDS`、`MAX_TOOL_CALLS`、`DEADLINE_EXCEEDED`、`CONSECUTIVE_FAILURES`、`LOOP_DETECTED`、`USER_DENIED`、`CANCELLED` 和 `FATAL_TOOL_ERROR`。

### 5. P1：Operit 执行前 Gate

- Remote Tool API 在进入实际 executor 前依次执行：协议解析 Gate、工具存在/暴露 Gate、Schema Gate、角色与用户权限 Gate、风险策略/确认 Gate、业务预条件 Gate。
- Schema Gate 使用工具注册表中的结构化 schema 校验必填字段、类型、枚举、范围、格式和额外字段；不再依赖字符串参数在工具内部自行猜测。
- 权限 Gate 复用 Operit 现有“全局默认 + 单工具例外”的 `ALLOW`、`ASK`、`FORBID` 模型，并与远程 allowlist、角色卡访问范围取交集。
- 预条件 Gate 验证设备能力、应用/服务状态、路径范围、网络状态和资源存在性。Gate 失败不得执行工具，也不得产生副作用。
- 高风险工具声明风险级别和所需控制：`dry-run`、用户确认、幂等 key、结果验证以及在可实现时的 rollback/compensation。

### 6. P1：执行稳定性与安全并行

- 工具元数据增加 `readOnly`、`sideEffect`、`parallelizable`、`resourceKeys`、`timeoutMs`、`maxAttempts` 和 `retryPolicy`。
- CoreCoder 可以并发提交同一模型轮次的调用，但 Operit 对最终执行顺序拥有约束权；只有元数据允许且资源 key 不冲突的调用并行执行。
- UI 自动化、同一路径写入、应用生命周期操作和其他全局设备状态操作默认串行。只读工具也必须在声明线程安全后才能并行。
- 每个调用应用 timeout；超时后返回 `TIMEOUT` 并尝试取消底层工作。无法强制取消的工具必须隔离资源并在 trace 中标记 `cancellationPending`。
- 副作用调用在客户端超时或断线后可通过 `requestId/idempotencyKey` 查询最终状态，避免盲目重放。

### 7. P1：越权与数据泄露防护

- 工具发现结果只暴露当前身份、角色、设备状态和会话策略允许的工具，不向模型展示不可调用的高风险能力。
- 所有调用重新在 Operit 服务端鉴权和授权，不能信任 CoreCoder 传入的风险级别、权限结论或工具元数据。
- 对文件路径、包名、URL、Intent、shell 命令和出站请求执行范围策略；高风险参数使用 allowlist 或显式用户确认。
- Tool Result 在返回模型前执行数据分类、长度限制和脱敏。token、Authorization、cookie、密钥、隐私标识和本地敏感路径默认不进入 trace 或模型上下文。
- Trace 使用参数摘要或 hash；必须保留原始值时写入访问受控的安全日志，并设置保留期限。

### 8. P2：100+ 工具的发现与延迟暴露

- Operit 工具注册表是唯一真实目录，工具元数据至少包含名称、版本、package、tags、用途、schema、风险、权限、side-effect、并发与资源策略。
- CoreCoder 初始只接收基础工具和远程 `tool_search`/`use_package` 能力；不在每轮 prompt 中注入全部工具 schema。
- `tool_search` 根据任务关键词、标签、package、权限和设备可用性返回少量候选及摘要；CoreCoder 选择后再获取完整 schema。
- `use_package` 表示激活 Operit 工具包并返回当前可用工具清单。工具注册进 Operit 的 map 是执行态准备，只有完整 schema 暴露给 CoreCoder 后才算对当前 Agent loop 可见。
- 会话维护已激活 package 和工具 schema cache，并通过目录版本/ETag 失效，避免每轮重复传输。

### 9. P0-P2：可观测性与质量指标

- CoreCoder 和 Operit 统一关联 `runId`、`taskId`、`turnIndex`、`toolCallId/requestId`、`traceId` 和 `attempt`。
- Tool trace 记录工具名、参数摘要/hash、结果摘要/hash、耗时、排队时间、Gate 决策、权限结论、错误码、重试次数、并发资源 key 和最终 stop reason。
- 记录模型修正次数、未知工具率、参数校验失败率、自动恢复率、循环熔断率、用户拒绝率和最终任务完成率。
- 首批 SLO 建议以基线测量后定阈值，至少覆盖：无失控副作用、所有运行可在预算内停止、协议错误可分类、trace 可跨端关联、golden 场景结果稳定。

## Testing Decisions

- 最高测试边界为“CoreCoder Agent -> Remote Tool Contract -> fake Operit runtime”的端到端契约测试。测试只断言外部行为：发送的调用、返回的分类、恢复动作和 stop reason，不断言内部函数调用。
- 同一份协议 fixture/JSON Schema 在 CoreCoder 和 Operit 两端运行兼容性测试，覆盖当前版本、缺失字段、未知字段、版本不兼容和错误类别；CI 中任何一端修改契约都必须通过双方 fixture。
- CoreCoder 使用 fake LLM + fake remote runtime 测 Agent-loop 状态机，覆盖：未知工具后搜索、参数错误后修正、瞬时错误不消耗模型轮次、授权转用户、fatal 停止、最大预算、相同调用循环、A/B 循环、无进展和最终回答。
- Operit 在 Remote Tool API handler 边界测试 Gate 与执行策略，覆盖：非法 JSON、Schema 字段错误、allowlist 拒绝、`ALLOW/ASK/FORBID`、前置条件失败、timeout、取消、重试退避、幂等重复、资源冲突串行和脱敏。
- 复用 CoreCoder 现有 Agent、LLM retry、Android remote tool 和 JSONL trace 测试风格；复用 Operit 现有 Remote Tool API model、工具权限和 ToolResult 测试风格。
- 真实设备 golden test 保留为最终验收层，至少包含：多步只读成功、预期失败后恢复、timeout、权限请求、用户拒绝、同参数重复熔断、写操作幂等、并行只读、冲突写串行、package 搜索/激活和敏感结果脱敏。
- 模型参与的 eval 与确定性契约测试分开：确定性测试负责协议和状态机正确性，固定模型/固定提示词的多次运行负责衡量工具选择、参数生成和任务完成率。
- 所有失败测试必须验证“未产生副作用”或“副作用只发生一次”；所有循环测试必须验证在预算内停止并产生明确 stop reason。

## Out of Scope

- 不在本规格中重写 CoreCoder 的基础 LLM provider、上下文压缩或通用 sub-agent 架构。
- 不把 Operit 的 Android 工具实现迁移到 CoreCoder，也不把 Agent planner 下沉到 Operit。
- 不要求一次性将所有 Operit 工具远程暴露；先覆盖代表性的只读、网络、UI 和副作用工具。
- 不以提示词代替服务端鉴权、Schema 校验、Gate、幂等和 loop budget。
- 不在 P0 阶段强制迁移到 MCP；先稳定领域契约，再评估 MCP/RPC 作为传输适配层。
- 不承诺所有 Android 操作都可 rollback；不可回滚操作必须通过确认、幂等和结果验证降低风险。

## Further Notes

- 当前基线中，CoreCoder 已有最大轮次、未知工具处理、Python 参数绑定校验、同轮多工具并行、LLM transient retry 和 JSONL trace；升级重点是把这些能力从局部机制提升为统一状态机和策略。
- 当前基线中，Operit 已有 Remote Tool API allowlist、基础结构化成功/失败、ToolResult、工具权限“全局默认 + 单工具例外”、工具包激活和内部并行工具集合；升级重点是统一元数据、Gate 顺序、错误分类和跨端契约。
- 第一条 tracer bullet 应只实现一种完整失败路径：Operit 返回 `INVALID_ARGUMENTS.fieldErrors`，CoreCoder 识别并允许模型修正一次，双方 trace 使用同一 `requestId/traceId`，契约测试和 fake-loop 测试通过。该路径能同时验证协议、职责边界、恢复和可观测性。
- 推荐交付顺序：P0 Contract -> P0 Agent-loop state machine -> P0 timeout/trace -> P1 Gate -> P1 metadata scheduler/idempotency -> P2 discovery/eval。每阶段都应保持旧 Remote Tool API 的兼容适配，直到真实设备 golden test 完成迁移。
