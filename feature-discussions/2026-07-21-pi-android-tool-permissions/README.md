---
doc_kind: design-proposal
project: KooAgent
created: 2026-07-21
status: approved
authored_by: codex
covers: [pi-extension, android-tools, permission-gate, persistence, testing]
---

# KooAgent Pi Android 工具权限设计

## 1. 结论

KooAgent 在 Pi extension 中为当前 27 个 Android 原子工具增加统一权限校验，权限决策只发生在 Pi-agent；Operit 保持纯远端执行器，不读取权限配置、不弹权限窗口，也不进行第二次 ALLOW/ASK/FORBID 判断。

权限模型沿用 Operit 原生系统最有价值的语义：

- 一个全局默认权限；
- 每个工具可设置覆盖规则；
- 权限级别为 `ALLOW / ASK / FORBID`；
- ASK 时向用户提供 `Allow once / Always allow / Deny`；
- 全新配置默认 `ASK`，因此 27 个工具最初都需要确认；
- 未登记的 `android_*` 工具一律拒绝，避免新增工具静默绕过权限。

Pi 原生 7 个工具没有内置权限弹窗；本方案使用 Pi 已有的 `tool_call` hook 和 extension UI 构建 KooAgent 自己的权限模块，不修改 Pi core。

## 2. 已确认的系统事实

### 2.1 当前远端工具数量是 27

当前 `.pi/extensions/kooagent-operit/tool-specs.ts` 注册 27 个工具，Operit `REMOTE_TOOL_ALLOWLIST` 也固定为同一组 27 个远端名称。

`android_run_ui_subagent / run_ui_subagent` 暂时移除：

- 不加入 Pi extension 工具目录；
- 不加入 Operit allowlist；
- 不参与本期权限矩阵；
- 历史 CoreCoder 代码、旧报告和 golden trace 中的引用不属于本期清理范围。

### 2.2 Pi 原生没有工具权限状态机

Pi 的 `read / bash / edit / write / grep / find / ls` 直接以 Pi 进程的系统权限执行。Pi 提供：

- `tool_call`：参数校验后、执行前触发，可返回 `{ block: true, reason }`；
- `ctx.ui.select()`：显示交互选择；
- `ctx.hasUI`：判断当前模式是否支持对话框；
- `tool_result`：执行后修改结果。

Pi 不提供：

- 内置 `ALLOW / ASK / FORBID` 存储；
- 内置 `Allow once / Always allow / Deny` 弹窗；
- 工具权限配置页面；
- 内置工具 sandbox。

### 2.3 Operit HTTP 是纯执行路径

当前远端 handler 的主路径是：

```text
Bearer 鉴权
  -> protocol v2 校验
  -> 27 工具 allowlist
  -> registerDefaultTools()
  -> getToolExecutor(toolName)
  -> validateParameters(tool)
  -> executionId 幂等/状态管理
  -> executor.invoke(tool)
  -> structured outcome
```

它不进入 Operit 的 `ToolExecutionManager.executeInvocations()`，也不调用 `ToolPermissionSystem.checkToolPermission()`。本方案保持这一点不变。

## 3. 目标与非目标

### 3.1 目标

1. 所有 27 个 Android 工具在调用远端 executor 前经过一次 Pi 权限决策。
2. 默认行为与 Operit 原生权限系统一致：全局默认 ASK，单工具规则优先。
3. ASK 支持允许本次、始终允许和拒绝本次。
4. 非交互模式无法询问时 fail closed。
5. 新增 Android 工具若未声明权限元数据，无法执行。
6. 权限拒绝作为标准 Pi error tool result 返回给模型，不打断 agent loop。
7. 权限检查与现有并发、幂等、重试、trace 和结果映射兼容。
8. 权限配置和审计记录不保存工具参数、输入文本、token 或工具结果。

### 3.2 非目标

- 不修改 Pi core。
- 不在 Operit 再做一次用户权限验证。
- 不复用 Android DataStore 中已有的 Operit 工具权限。
- 不修改 Remote Tool API v2 请求或 outcome 格式。
- 不增加 authorization/grant endpoint。
- 不为 Pi 原生 7 个工具增加权限。
- 不在本期恢复 `run_ui_subagent`。
- 不把进程内权限弹窗描述为安全 sandbox。

## 4. 职责与信任模型

```text
LLM
  -> Pi agent loop
  -> kooagent-operit tool_call hook
       -> PermissionGate
       -> PermissionStore
       -> Pi UI adapter
  -> extension tool execute
  -> Operit Remote Tool API v2
  -> Android executor
```

| 模块 | 职责 |
| --- | --- |
| Pi agent loop | 参数校验、顺序 preflight、block 转 error result、工具调度。 |
| KooAgent extension | 工具目录、权限决策、权限 UI、权限持久化、远端协议适配。 |
| Operit HTTP | Bearer 鉴权、allowlist、参数校验、幂等、状态、取消、超时和 outcome。 |
| Android executor | 执行真实 Android、文件、网络或记忆操作。 |

安全假设：Operit Remote Tool API 是受信任的内部执行接口。任何持有 bearer token 且能访问该端口的客户端，都拥有直接调用 allowlist 工具的能力。部署必须保证 token 不进入仓库/trace，端口不暴露到公共网络，并支持 token 轮换。

这项部署约束不等于在 Operit 增加用户权限判断。

## 5. 权限语义

### 5.1 权限级别

```ts
export type OperitPermissionLevel = "allow" | "ask" | "forbid";
```

| 级别 | 行为 |
| --- | --- |
| `allow` | 不弹窗，允许当前调用。 |
| `ask` | 弹出权限选择；无 UI 时拒绝。 |
| `forbid` | 不弹窗，直接拒绝。 |

### 5.2 有效权限

```text
effectiveLevel = toolOverride[toolName] ?? defaultLevel
```

单工具覆盖始终优先于全局默认：

| 单工具覆盖 | 全局默认 | 有效权限 |
| --- | --- | --- |
| ALLOW | 任意 | ALLOW |
| ASK | 任意 | ASK |
| FORBID | 任意 | FORBID |
| 无 | ALLOW | ALLOW |
| 无 | ASK | ASK |
| 无 | FORBID | FORBID |

初始配置：

```json
{
  "version": 1,
  "defaultLevel": "ask",
  "tools": {}
}
```

因此 27 个工具初始全部 ASK，没有按读/写/网络类别自动放行。

### 5.3 ASK 交互

交互选项固定为：

```text
Allow once
Always allow
Deny
```

语义：

- `Allow once`：只授权当前 `toolCallId`，不持久化；同名工具下一次调用重新询问。
- `Always allow`：把当前工具的项目级覆盖写为 `ALLOW`，并授权当前调用。
- `Deny`：拒绝当前调用，不写入 `FORBID`；下一次仍按原规则处理。
- 用户取消对话框等价于 `Deny`。
- 永久 `FORBID` 通过配置或 `/operit-permissions` 管理命令设置，不由 ASK 弹窗隐式产生。

如果 `Always allow` 的持久化失败：

- 当前调用按 `Allow once` 处理；
- UI 显示 warning，明确“未能保存，后续仍会询问”；
- 不在内存中假装已经永久允许。

### 5.4 非交互模式

当 `ctx.hasUI === false`：

- ALLOW：执行；
- FORBID：拒绝；
- ASK：拒绝，理由为 `Permission confirmation requires an interactive Pi session`。

不使用环境变量或命令行模式隐式把 ASK 升级成 ALLOW。无人值守运行必须显式配置 ALLOW 规则。

## 6. 27 工具权限矩阵

所有工具初始默认均为 ASK。下表中的“操作摘要”只用于权限窗口，不改变默认级别。

| Pi 工具 | Operit 工具 | 权限窗口操作摘要 | 敏感字段展示规则 |
| --- | --- | --- | --- |
| `android_list_installed_apps` | `list_installed_apps` | 读取已安装的第三方应用列表 | 无参数 |
| `android_start_app` | `start_app` | 启动指定 Android 应用 | 显示 package name |
| `android_capture_screenshot` | `capture_screenshot` | 截取当前 Android 屏幕 | 无参数 |
| `android_get_page_info` | `get_page_info` | 读取当前页面和控件信息 | 显示 format/detail/display |
| `android_tap` | `tap` | 点击屏幕坐标 | 显示坐标和 display |
| `android_long_press` | `long_press` | 长按屏幕坐标 | 显示坐标和 display |
| `android_swipe` | `swipe` | 在屏幕上滑动 | 显示起止坐标、时长和 display |
| `android_click_element` | `click_element` | 点击匹配的 UI 元素 | 显示 selector，长度受限 |
| `android_set_input_text` | `set_input_text` | 向当前输入框写入文本 | 不显示正文，只显示字符数 |
| `android_press_key` | `press_key` | 发送 Android 按键 | 显示 key code 和 display |
| `android_sleep` | `sleep` | 等待指定时长 | 显示 duration |
| `android_use_package` | `use_package` | 激活 Operit 动态工具包 | 显示 package name |
| `android_list_files` | `list_files` | 列出指定目录 | 显示 path/environment，长度受限 |
| `android_read_file` | `read_file` | 读取指定文件 | 显示 path，不显示内容 |
| `android_read_file_part` | `read_file_part` | 读取指定文件片段 | 显示 path 和范围，不显示内容 |
| `android_apply_file` | `apply_file` | 应用文件内容或补丁 | 显示目标 path，不显示正文 |
| `android_create_file` | `create_file` | 创建文件 | 显示 path，不显示正文 |
| `android_edit_file` | `edit_file` | 修改文件 | 显示 path，不显示新旧正文 |
| `android_delete_file` | `delete_file` | 删除文件或目录 | 显示目标 path |
| `android_make_directory` | `make_directory` | 创建目录 | 显示 path |
| `android_find_files` | `find_files` | 搜索文件 | 显示 path 和 pattern，长度受限 |
| `android_grep_code` | `grep_code` | 搜索文件内容 | 显示 path；pattern 截断 |
| `android_grep_context` | `grep_context` | 搜索并读取匹配上下文 | 显示 path；pattern 截断 |
| `android_visit_web` | `visit_web` | 访问网络地址 | 仅显示 scheme、host 和 path；隐藏 query/fragment |
| `android_download_file` | `download_file` | 从网络下载文件 | 显示来源 host 和目标 path；隐藏 query |
| `android_query_memory` | `query_memory` | 查询 Operit 记忆 | 不显示完整 query，只显示字符数或短摘要 |
| `android_get_memory_by_title` | `get_memory_by_title` | 按标题读取记忆 | 标题截断显示 |

工具目录是权限覆盖的唯一事实来源。测试必须断言这张目录与 `OPERIT_TOOL_SPECS` 精确一致，而不是只断言数量为 27。

## 7. 模块设计

### 7.1 文件布局

```text
.pi/extensions/kooagent-operit/
  index.ts
  tool-specs.ts
  permission-types.ts
  permission-gate.ts
  permission-store.ts
  permission-ui.ts
  test/
    permission-gate.test.ts
    permission-store.test.ts
    permission-tool-coverage.test.ts
```

### 7.2 Tool spec 扩展

执行策略和权限策略表达不同问题，保持为两个字段：

```ts
export interface OperitPermissionSpec {
  describe(input: Record<string, unknown>): string;
}

export interface OperitToolSpec {
  localName: string;
  remoteName: string;
  description: string;
  parameters: OperitParameterSpec[];
  policy: OperitToolExecutionPolicy;
  permission: OperitPermissionSpec;
}
```

27 个工具统一使用“持久化单工具覆盖，否则继承全局默认”的规则。不要再增加 spec 级默认值，也不要根据现有 `policy.effect` 自动推导权限，因为并发/幂等语义不等于用户授权语义；第三层默认来源只会制造优先级歧义。

### 7.3 PermissionGate 深模块

外部 seam 保持小接口：

```ts
export interface PermissionGate {
  authorize(request: PermissionRequest): Promise<PermissionDecision>;
  consume(toolCallId: string): boolean;
  clearSession(): void;
}

export interface PermissionRequest {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  hasUI: boolean;
  signal?: AbortSignal;
}

export type PermissionDecision =
  | { allowed: true; source: "rule" | "once" | "always" }
  | { allowed: false; reason: string };
```

`PermissionGate` 隐藏以下实现复杂度：

- 有效规则计算；
- ASK UI；
- 持久化；
- 工具参数安全摘要；
- `toolCallId` 一次性授权；
- AbortSignal；
- 配置异常与 fail-closed；
- 审计事件生成。

调用者只需要在 `tool_call` 调 `authorize()`，在 `execute()` 调 `consume()`。

### 7.4 PermissionStore

持久配置属于 Pi 用户状态，不写入 Operit，也不提交到项目仓库。

推荐路径：

```text
~/.pi/agent/kooagent-operit/permissions.json
```

推荐格式：

```json
{
  "version": 1,
  "projects": {
    "/canonical/path/to/kooagent": {
      "defaultLevel": "ask",
      "tools": {
        "android_capture_screenshot": "allow",
        "android_delete_file": "forbid"
      }
    }
  }
}
```

规则按 canonical project root 隔离。当前单设备开发环境不再按 `OPERIT_URL` 分区；如果未来一个项目可切换多台不等价设备，需要加入稳定 device identity 后再扩展 schema，不能用固定 adb forward URL 代替设备身份。

存储要求：

- schema version 必填；
- 只接受已知字段和已知工具名；
- 未知/损坏配置回退为默认 ASK，并向用户 warning；
- 原子写入：临时文件、flush、rename；
- 文件权限尽可能设置为 `0600`；
- 不保存 tool arguments、token、结果或操作摘要；
- 写入只更新当前项目节点，不覆盖其他项目配置；
- 不使用 `pi.appendEntry()` 保存 Always allow，因为 session entry 不是跨会话用户配置。

### 7.5 Permission UI adapter

UI adapter 负责把纯权限请求转换为 Pi UI 调用：

```ts
export interface PermissionPrompt {
  choose(request: PermissionPromptRequest): Promise<PermissionPromptChoice>;
  warn(message: string): void;
}
```

这样 PermissionGate 测试不依赖真实 TUI，TUI/RPC 的差异由 `ctx.hasUI` 和 adapter 吸收。

## 8. Hook 与执行时序

### 8.1 Extension 注册

Extension 初始化时：

1. 加载并校验持久配置；
2. 从 `OPERIT_TOOL_SPECS` 建立 `specsByLocalName`；
3. 创建一个 session-scoped `PermissionGate`；
4. 注册一次 `tool_call` handler；
5. 注册 27 个工具；
6. 保留现有 `tool_result`、trace 和 lifecycle handlers。

### 8.2 tool_call

```ts
pi.on("tool_call", async (event, ctx) => {
  const spec = specsByLocalName.get(event.toolName);

  if (!spec) {
    if (event.toolName.startsWith("android_")) {
      return {
        block: true,
        reason: `[ANDROID_PERMISSION_DENIED] Unknown Android tool: ${event.toolName}`,
      };
    }
    return undefined;
  }

  const decision = await permissionGate.authorize({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    input: event.input,
    hasUI: ctx.hasUI,
    signal: ctx.signal,
  });

  if (!decision.allowed) {
    return {
      block: true,
      reason: [
        "[ANDROID_PERMISSION_DENIED]",
        `tool=${event.toolName}`,
        `reason=${decision.reason}`,
      ].join("\n"),
    };
  }

  return undefined;
});
```

Pi 会把 block 转成 `isError=true` 的 ToolResultMessage，模型可以解释拒绝或询问用户修改规则。

### 8.3 execute

每个 extension tool 的 `execute()` 在发出 HTTP 请求前消费一次性授权：

```ts
if (!permissionGate.consume(toolCallId)) {
  throw new Error(
    `[ANDROID_PERMISSION_STATE_MISSING] ${spec.localName} ` +
      "was not authorized by the Pi tool_call hook",
  );
}
```

这不是第二次权限决策，也不弹窗；它只是确保工具执行不能在 extension 内部意外绕过 hook。

消费发生在整个 `executeWithTransportRetry()` 之前。一次 `execute()` 内部的网络重试继续复用同一次用户授权，不再次询问；新的模型 tool call 拥有新的 `toolCallId`，必须重新走规则。

### 8.4 session 生命周期

- `session_start`：加载当前项目规则，创建空的一次性授权集合。
- `agent_start`：不清理持久规则，也不清理已完成 preflight 尚未执行的授权。
- `session_shutdown`：清空所有未消费的一次性授权。
- extension reload：旧 gate 清空，新实例重新加载持久规则。

不使用 `turn_end` 无条件清空，因为并行工具可能尚在完成流程中；授权在 `execute()` 开头消费后自然移除。

## 9. 并发与错误语义

Pi 在并行工具模式下会顺序执行 sibling tool calls 的 preflight，然后并发执行已授权工具。因此：

- 权限弹窗不会在同一个模型批次中重叠；
- `toolCallId` 集合可安全关联每个调用；
- 允许后的只读工具仍可按原 execution policy 并发；
- 任一 sibling 被拒绝不会阻止其他已授权 sibling 执行；
- 最终 ToolResultMessage 仍按模型原始调用顺序进入会话。

错误规则：

| 情况 | 行为 |
| --- | --- |
| FORBID | block，`ANDROID_PERMISSION_DENIED` |
| ASK 用户拒绝/取消 | block，`ANDROID_PERMISSION_DENIED` |
| ASK 无 UI | block，`ANDROID_PERMISSION_DENIED` |
| 权限 handler 抛异常 | 依赖 Pi fail-safe，block |
| 配置损坏 | 回退 ASK、warning，不自动允许 |
| Always allow 写入失败 | 当前允许一次、warning、未来继续 ASK |
| execute 找不到授权 | throw `ANDROID_PERMISSION_STATE_MISSING`，不发 HTTP |
| 用户中止 signal | 不创建授权，block/abort |

## 10. 权限管理命令

建议本期提供一个 `/operit-permissions` 命令，避免用户必须手工编辑 JSON。

最小能力：

```text
/operit-permissions
  -> 查看当前项目全局默认
  -> 修改全局 ALLOW / ASK / FORBID
  -> 查看 27 个工具的有效权限和覆盖来源
  -> 为单工具设置 ALLOW / ASK / FORBID
  -> 清除单工具覆盖
  -> 重置当前项目规则为默认 ASK
```

命令是 PermissionStore 的一个 adapter，不把管理逻辑塞进 PermissionGate。非交互模式下命令只输出当前状态，不尝试打开选择器。

## 11. 审计与可观测性

权限事件建议写入现有 JSONL trace，但只记录：

```json
{
  "event": "android_tool_permission",
  "sessionId": "...",
  "runId": "...",
  "turnIndex": 1,
  "toolCallId": "...",
  "toolName": "android_delete_file",
  "effectiveLevel": "ask",
  "decision": "deny",
  "source": "user_prompt",
  "timestampMs": 0
}
```

禁止记录：

- `event.input`；
- 操作摘要；
- 文件内容或输入文本；
- URL query；
- bearer token；
- permission store 全量内容。

权限拒绝没有 Operit `executionId`，因为 HTTP 请求尚未创建。trace 关联以 Pi `toolCallId` 为止，这是预期语义。

## 12. 测试方案

### 12.1 PermissionGate 单元测试

1. 全局 ALLOW 自动允许且不调用 UI。
2. 全局 FORBID 自动拒绝且不调用 UI。
3. 全局 ASK + Allow once 只授权当前 `toolCallId`。
4. Allow once 被消费后不能再次消费。
5. ASK + Always allow 持久化工具 ALLOW 并允许当前调用。
6. Always allow 写入失败时只允许当前调用并 warning。
7. ASK + Deny 不创建授权、不持久化。
8. 对话框取消等价 Deny。
9. ASK + `hasUI=false` 拒绝。
10. AbortSignal 中止时不创建授权。
11. 单工具规则优先于全局规则。
12. 配置读取失败回退 ASK，不 fail open。

### 12.2 工具目录测试

1. `OPERIT_TOOL_SPECS.length === 27`。
2. 27 个 localName 唯一。
3. 27 个 remoteName 唯一。
4. 每个 spec 都有 permission 描述器。
5. local/remote 名称集合与预期 fixture 精确相等。
6. 不包含 `android_run_ui_subagent / run_ui_subagent`。
7. 未登记 `android_*` 调用被 block。
8. 非 Android、非 Operit 工具不受该 hook 影响。

### 12.3 PermissionStore 测试

1. 空文件/不存在文件得到默认 ASK。
2. 原子写入后可重新加载。
3. 当前项目更新不影响其他项目。
4. 未知 schema version 拒绝加载并回退 ASK。
5. 未知 tool name 不生效并 warning。
6. 损坏 JSON 不导致 ALLOW。
7. 文件中不出现 arguments、token 或 result 字段。

### 12.4 Extension 集成测试

1. Deny 时 `callOperitTool` 调用次数为 0。
2. Allow 时远端调用恰好一次。
3. `execute()` 缺少 authorization marker 时不发 HTTP。
4. transport retry 不触发第二次权限询问。
5. 两个 sibling ASK 调用顺序询问。
6. 一个 sibling 拒绝时另一个允许调用仍执行。
7. 权限 block 进入模型的结果是 `isError=true`。
8. 现有 Operit outcome `tool_result` 映射保持不变。
9. `set_input_text`、memory query、URL 等摘要不泄漏敏感内容。

### 12.5 手工验收

使用 Pi TUI 和真实设备验证：

1. 清空当前项目权限配置。
2. 调用 `android_list_installed_apps`，选择 Allow once；成功后再次调用，应再次询问。
3. 调用同一工具，选择 Always allow；重启 Pi 后再次调用，不再询问。
4. 将 `android_delete_file` 设置为 FORBID；调用后模型收到拒绝，Android 无副作用。
5. 以 `-p` 或 JSON 模式调用 ASK 工具；必须拒绝且不发 HTTP。
6. `/operit-permissions` 重置当前项目；所有工具恢复 ASK。

## 13. 实施步骤

### 阶段 1：纯权限模块

- 新增 permission types、store、UI adapter 和 gate。
- 完成 Gate 与 Store 单元测试。
- 不接入现有工具执行。

完成条件：纯测试覆盖所有状态转换和错误分支。

### 阶段 2：接入 extension

- 给 27 个 tool spec 增加安全操作摘要。
- 注册统一 `tool_call` hook。
- 在 27 个工具共用的 execute 路径消费授权。
- session shutdown 清理授权。

完成条件：Deny 零 HTTP 调用；Allow 不改变现有 v2 request/outcome。

### 阶段 3：管理与审计

- 增加 `/operit-permissions`。
- 增加无参数的权限审计 trace。
- 更新 extension README 与调试文档。

完成条件：用户无需编辑 JSON 即可管理全局规则和单工具覆盖。

### 阶段 4：回归验证

- 运行 extension 格式化、类型检查和定向测试。
- 运行现有 v2 extension tests。
- 做 Pi TUI 真机 Allow once / Always allow / Deny 验收。
- 不运行 Android Gradle；本期没有 Android 代码变化。

## 14. 验收标准

本方案实现完成需同时满足：

- Pi 和 Operit 源码核心均未为权限功能修改；权限实现只位于 KooAgent extension。
- 当前只暴露 27 个远端工具，`run_ui_subagent` 不可调用。
- 27 个工具没有权限声明遗漏。
- 新配置下 27 个工具全部 ASK。
- Allow once、Always allow、Deny 行为可重复验证。
- FORBID 和非交互 ASK 均保证零 HTTP 调用、零 Android 副作用。
- Always allow 跨 Pi 会话生效，但只作用于当前 canonical project root。
- transport retry 不重复询问，也不扩大授权到新的 tool call。
- 权限拒绝对模型可见且为 `isError=true`。
- trace 和权限存储不泄漏参数、输入正文、token 或结果。
- Operit v2 协议、allowlist、幂等、取消、timeout 和 outcome 语义不变。

## 15. 已接受的权衡

1. 权限是 Pi 内的产品 Gate，不是操作系统 sandbox；受信任 extension 仍拥有 Pi 进程权限。
2. 直接持有 Operit bearer token 的客户端可以绕过 Pi 权限；通过内部端口和 token 管理控制该风险。
3. 27 个工具全部默认 ASK 最安全但首次使用较繁琐；用户可用 Always allow 或管理命令逐步放行。
4. 规则按项目隔离而非按设备隔离，符合当前单设备开发环境；多设备支持需要稳定 device identity 后再设计。
5. 本期不提供“本会话始终允许”，保持与 Operit 原生三按钮语义一致；以后如有实际需求再增加，不让一期状态模型膨胀。

## 16. 已批准决策

以下实现决策已确认：

1. `Always allow` 表示当前 canonical project root 下跨 Pi 会话的永久单工具 ALLOW 覆盖，而不是仅当前 Pi 会话。
2. 权限配置文件固定存放于 `~/.pi/agent/kooagent-operit/permissions.json`。
3. `/operit-permissions` 纳入第一期，提供全局默认、单工具覆盖、清除覆盖和重置当前项目规则的交互管理。

因此可以按第 13 节的四个阶段直接实施；权限所在层、27 工具范围、默认 ASK、Operit 零权限逻辑、非交互 fail closed 和未知工具拒绝均为已确定约束。
