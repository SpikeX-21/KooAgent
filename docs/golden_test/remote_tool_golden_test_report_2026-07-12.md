# Operit Remote Tool API Golden Test 测试报告

日期：2026-07-12

## 测试范围

本次 golden test 验证的是 CoreCoder 风格的 Android 运行态工具调用最短真实设备链路：

```text
Mac 主机
-> HTTP POST http://127.0.0.1:8094/api/device/tool-call
-> adb forward tcp:8094 tcp:8094
-> Xiaomi 手机
-> Operit ExternalChatHttpServer
-> RemoteToolApiHandler
-> AIToolHandler.executeTool(...)
-> Operit 内置工具
-> HTTP JSON 返回
```

本次运行采用确定性的自然语言任务计划，并通过真实 Remote Tool API 发起调用。它没有调用 LLM planner，因此本报告验证的是远程工具执行层、trace 结构、停止行为和失败返回语义，不验证模型自主规划质量。

Trace 文件：

- `Operit/docs/golden_test/golden_traces/remote_tool_golden_2026-07-12.jsonl`

## 测试环境

- 主机工作区：`/Users/spike21/workspace/code/kooagent`
- 设备：Xiaomi 手机，通过 `adb forward tcp:8094 tcp:8094` 连接
- Base URL：`http://127.0.0.1:8094`
- 鉴权：使用用户提供的 Bearer token，本报告中已脱敏
- 健康检查：`GET /api/device/health` 返回 `{"success":true,"status":"ok"}`
- 工具清单：`GET /api/device/tools` 返回 18 个工具

可见的内置工具：

```text
apply_file, create_file, delete_file, download_file, edit_file, find_files,
get_memory_by_title, grep_code, grep_context, list_files, list_installed_apps,
make_directory, query_memory, read_file, read_file_part, sleep, use_package,
visit_web
```

## 通过标准

- 输入是一个自然语言任务。
- server/tool 链路至少能连续执行 3 步工具调用。
- 每一步都写入 trace event。
- 任务达到 `final_answer` 或 `max_steps` 时能够停止。
- 工具失败会返回结构化失败数据，不会导致 server 或测试流程崩溃。

本次确定性 golden harness 满足以上标准。

## 任务 1：检查下载目录中的 Operit 内容

自然语言任务：

```text
检查下载目录里 Operit 相关内容。
```

执行步骤：

| 步骤 | 工具 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 1 | `list_files /sdcard/Download` | 成功。Download 目录列表中包含 `Operit`。 | 79 ms |
| 2 | `find_files /sdcard/Download pattern=Operit` | 成功。找到 `/sdcard/Download/Operit`。 | 57 ms |
| 3 | `list_files /sdcard/Download/Operit` | 成功。列出 `mcp_plugins`、`workflow`、`packageLogs`、`plugins`、`skills`、`backup`、`cleanOnExit`。 | 56 ms |

停止原因：`final_answer`

最终回答：

```text
Download 目录下存在 Operit 目录，目录内包含 mcp_plugins、workflow、packageLogs、plugins、skills、backup、cleanOnExit。
```

状态：通过。

## 任务 2：定位并读取一个小型数据文件

自然语言任务：

```text
定位并读取一个下载目录里的小配置/数据文件。
```

执行步骤：

| 步骤 | 工具 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 1 | `find_files /sdcard/Download pattern=*.data` | 成功。找到 `/sdcard/Download/.exmu-cfg1.data`。 | 35 ms |
| 2 | `read_file /sdcard/Download/.exmu-cfg1.data` | 成功。文件内容是一行 token-like 数据，本报告中已脱敏。 | 50 ms |
| 3 | `read_file_part /sdcard/Download/.exmu-cfg1.data lines=1-1` | 成功。返回同一行内容，本报告中已脱敏。 | 49 ms |

停止原因：`final_answer`

最终回答：

```text
在 Download 目录找到 .exmu-cfg1.data，并成功通过 read_file 与 read_file_part 读取。内容是单行 token-like 数据，报告中已脱敏。
```

状态：通过。

## 任务 3：失败处理与恢复执行

自然语言任务：

```text
验证工具失败不会导致流程崩溃，并能继续完成后续检查。
```

执行步骤：

| 步骤 | 工具 | 结果 | 耗时 |
| --- | --- | --- | --- |
| 1 | `read_file /sdcard/Download/__golden_missing_file__.txt` | 预期失败。返回 `success=false` 和 `Path is not a file: /sdcard/Download/__golden_missing_file__.txt`。 | 19 ms |
| 2 | `sleep duration_ms=1` | 在上一步失败后继续成功执行。 | 18 ms |
| 3 | `list_files /sdcard/Download/Operit` | 在失败后继续成功执行，并列出 Operit 子目录。 | 57 ms |

停止原因：`final_answer`

最终回答：

```text
缺失文件读取按预期返回 success=false 和明确错误；随后 sleep 与 list_files 继续成功执行，说明工具失败没有导致 Remote Tool API 流程崩溃。
```

状态：通过，包含 1 个预期工具失败。

## Trace 结构

每一步工具调用都会记录为一条 JSONL event，字段包括：

- `runId`
- `taskId`
- `naturalLanguageGoal`
- `stepIndex`
- `toolName`
- `arguments`
- `success`
- `latencyMs`
- `resultTextPreview`
- `error`

每个任务还会写入一条 `final_answer` event，字段包括：

- `status`
- `stopReason`
- `stepsExecuted`
- `answer`

## 异常处理观察

缺失文件 case 返回了正常 HTTP JSON body：

```json
{
  "success": false,
  "resultText": "",
  "error": "Path is not a file: /sdcard/Download/__golden_missing_file__.txt"
}
```

这是 CoreCoder 集成需要的行为：调用方可以把它当成工具级失败，将错误信息追加到 agent context，然后继续下一轮循环。server 没有崩溃，后续工具调用也能继续成功执行。

CoreCoder 的 `OperitRemoteTool.execute(...)` 已经会把这种返回映射成面向模型的普通文本：

```text
Error from Android Runtime (<tool_name>): <error>
```

因此 agent loop 可以继续运行，不会把 Python 或 Kotlin 堆栈直接暴露给模型。

## 限制说明

- 本次 golden run 使用的是确定性工具计划，不是 LLM planner 自主规划。它验证的是 Android 远程执行路径和 trace 格式，不验证模型规划质量。
- 从沙箱内 Python 进程直接运行 CoreCoder SDK smoke test 时失败，错误为 `[Errno 1] Operation not permitted`，原因是本地沙箱阻止 Python 访问 localhost。提升权限重试被本地审批器拒绝。已通过获准的 `curl` 路径验证同一个真实 adb-forwarded Remote Tool API endpoint。
- 本次测试避免使用写入和删除类工具，以保持手机状态稳定。后续可以在 `/sdcard/Download/Operit/golden_tests` 下建立专用临时目录，再补一轮写路径 golden test。

## 结论

Remote Tool API 对本次测试覆盖的内置工具表现正常。它支持多步骤连续执行，能够产出可追踪的结构化结果，可以在 `final_answer` 停止，并且能以结构化方式处理工具级失败，不会导致 server 路径崩溃。

建议下一步：在仓库中加入一个小型测试 harness，接收自然语言任务，执行固定计划或模型生成计划，通过 `max_steps` 控制循环，并自动写入同样格式的 JSONL trace。
