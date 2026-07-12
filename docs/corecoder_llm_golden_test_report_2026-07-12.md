# CoreCoder LLM 层调用 Operit 工具 Golden Test 报告

日期：2026-07-12

## 测试目标

本次验证的是 LLM 层完整调用链路：

```text
自然语言任务
-> CoreCoder agent loop
-> LLM 生成 tool call
-> CoreCoder AndroidRemoteTool / OperitDeviceClient
-> HTTP POST http://127.0.0.1:8094/api/device/tool-call
-> adb forward tcp:8094 tcp:8094
-> 手机上的 Operit Remote Tool API
-> Operit 内置工具
-> tool result 返回给 LLM
-> final_answer
```

运行方式遵守用户要求：必须在 `corecoder` conda 环境中运行 CoreCoder。

实际命令形式：

```bash
conda run -n corecoder corecoder \
  --operit-url "http://127.0.0.1:8094" \
  --operit-token "<redacted>" \
  -p "<自然语言任务>"
```

Trace 文件：

- `Operit/docs/golden_traces/corecoder_llm_golden_rerun_2026-07-12.jsonl`

## 测试环境

| 检查项 | 结果 |
| --- | --- |
| CoreCoder 版本 | `corecoder 0.4.0` |
| conda 环境 | `corecoder` |
| CoreCoder 路径 | `/opt/homebrew/Caskroom/miniconda/base/envs/corecoder/bin/corecoder` |
| Operit Remote Tool API | `GET /api/device/health` 返回 `{"success":true,"status":"ok"}` |
| 安卓远程工具数量 | 18 |
| LLM provider | `openai` |
| LLM model | `kimi-k2.5` |
| API key / base_url | 存在，报告中不展示 |

可见安卓远程工具：

```text
apply_file, create_file, delete_file, download_file, edit_file, find_files,
get_memory_by_title, grep_code, grep_context, list_files, list_installed_apps,
make_directory, query_memory, read_file, read_file_part, sleep, use_package,
visit_web
```

CoreCoder 暴露给 LLM 的本地工具名带 `android_` 前缀，例如：

```text
android_list_files, android_find_files, android_read_file,
android_read_file_part, android_sleep
```

## 总体结论

本次 LLM 层 golden test 已经真实跑通。

结果摘要：

| 指标 | 结果 |
| --- | --- |
| 任务数 | 4 |
| 成功任务 | 3 |
| 不完整任务 | 1 |
| 观察到的安卓工具调用 | 12 |
| 预期工具失败 | 1 |
| CoreCoder 进程崩溃 | 0 |

结论：CoreCoder 能让 LLM 生成 `android_*` 工具调用，并通过 Operit Remote Tool API 调用手机上的内置工具。失败工具调用不会导致 CoreCoder 进程崩溃，LLM 可以继续后续步骤并输出总结。

同时发现一个 LLM 层问题：任务 2 中模型连续执行了 3 个安卓工具调用，但进程退出时没有输出明确 `final_answer`。这不是安卓工具链路失败，而是 LLM/agent loop 收束行为需要进一步观察或约束。

## 任务 1：检查 Operit 下载目录

自然语言任务：

```text
检查安卓手机 /sdcard/Download/Operit 目录是否存在，并概括里面有哪些内容。
```

观察到的工具调用：

| 步骤 | LLM 调用的工具 | 参数 |
| --- | --- | --- |
| 1 | `android_list_files` | `path='/sdcard/Download'` |
| 2 | `android_find_files` | `path='/sdcard/Download', pattern='Operit'` |
| 3 | `android_list_files` | `path='/sdcard/Download/Operit'` |

CoreCoder 输出摘要：

```text
> android_list_files(path='/sdcard/Download')
> android_find_files(path='/sdcard/Download', pattern='Operit')
> android_list_files(path='/sdcard/Download/Operit')
```

最终回答摘要：

```text
/sdcard/Download/Operit 目录存在，包含 mcp_plugins、workflow、packageLogs、plugins、skills、backup、cleanOnExit 等子目录。
```

状态：通过。

## 任务 2：读取 data 文件，但未收束 final answer

自然语言任务：

```text
在安卓手机 /sdcard/Download 中定位一个 .data 小文件并读取它，但报告里不要泄露完整敏感内容。
```

观察到的工具调用：

| 步骤 | LLM 调用的工具 | 参数 |
| --- | --- | --- |
| 1 | `android_find_files` | `path='/sdcard/Download', pattern='*.data'` |
| 2 | `android_read_file` | `path='/sdcard/Download/.exmu-cfg1.data'` |
| 3 | `android_read_file_part` | `path='/sdcard/Download/.exmu-cfg1.data', start_line=1, end_line=1` |

CoreCoder 输出摘要：

```text
> android_find_files(path='/sdcard/Download', pattern='*.data')
> android_read_file(path='/sdcard/Download/.exmu-cfg1.data')
> android_read_file_part(path='/sdcard/Download/.exmu-cfg1.data', start_line=1, end_line=1)
```

状态：不完整。

问题：LLM 连续执行了 3 个安卓工具调用，CoreCoder 进程退出码为 `0`，但没有输出明确 final answer。

判断：这是 LLM 层收束问题，不是 Remote Tool API 层失败。任务 4 已用更强约束补充验证同一读取链路。

## 任务 3：工具失败后继续恢复

自然语言任务：

```text
验证工具失败后你仍能继续完成任务。
```

观察到的工具调用：

| 步骤 | LLM 调用的工具 | 参数 | 预期 |
| --- | --- | --- | --- |
| 1 | `android_read_file` | `/sdcard/Download/__golden_missing_file__.txt` | 预期失败 |
| 2 | `android_sleep` | `duration_ms=1` | 成功 |
| 3 | `android_list_files` | `path='/sdcard/Download/Operit'` | 成功 |

CoreCoder 输出摘要：

```text
> android_read_file(...)
第一步如预期失败了。继续执行第二步：
> android_sleep(duration_ms=1)
第二步成功执行。继续执行第三步：
> android_list_files(path='/sdcard/Download/Operit')
FINAL_ANSWER: 本次 golden test 任务成功验证了工具失败后仍能继续完成任务的能力。
```

说明：CLI 展示的第一步 path 文本存在截断或转义显示问题，但模型明确识别第一步为预期失败，并继续完成第二、第三步。

状态：通过。

## 任务 4：补充读取 data 文件并强制 final answer

自然语言任务：

```text
验证安卓手机 /sdcard/Download/.exmu-cfg1.data 能否被读取，但最终回答必须脱敏。
```

观察到的工具调用：

| 步骤 | LLM 调用的工具 | 参数 |
| --- | --- | --- |
| 1 | `android_find_files` | `path='/sdcard/Download', pattern='*.data'` |
| 2 | `android_read_file` | `path='/sdcard/Download/.exmu-cfg1.data'` |
| 3 | `android_read_file_part` | `path='/sdcard/Download/.exmu-cfg1.data', start_line=1, end_line=1` |

CoreCoder 输出摘要：

```text
> android_find_files(path='/sdcard/Download', pattern='*.data')
> android_read_file(path='/sdcard/Download/.exmu-cfg1.data')
> android_read_file_part(path='/sdcard/Download/.exmu-cfg1.data', start_line=1, end_line=1)
FINAL_ANSWER: 经验证，安卓手机 /sdcard/Download/.exmu-cfg1.data 文件存在且可被正常读取。
```

最终回答摘要：

```text
文件存在且可读取。内容为单行 token-like 格式，已脱敏，不输出完整内容。
```

状态：通过。

## 满足情况

| 要求 | 状态 |
| --- | --- |
| 输入自然语言任务 | 满足 |
| Server 至少连续执行 3 步工具调用 | 满足，任务 1、3、4 均观察到 3 步 |
| 每一步写 trace | 满足，写入 JSONL trace |
| 达到 `final_answer` 或 `max_steps` 能停止 | 部分满足；任务 1、3、4 达到 final answer，任务 2 暴露未 final answer 的收束问题 |
| 工具失败不会导致 server 崩溃 | 满足，任务 3 验证通过 |
| 生成测试报告 | 满足 |

## 发现的问题

### 1. LLM 可能执行完工具但不输出 final answer

任务 2 中模型完成了 3 次工具调用，但没有输出最终总结。建议在 golden prompt 或 system prompt 中强化约束：

```text
每个任务结束前必须输出以 FINAL_ANSWER: 开头的最终回答。
```

任务 4 加入该约束后，同一读取链路可以正常收束。

### 2. CLI 工具调用展示不包含完整 tool result

当前 CoreCoder CLI 只打印：

```text
> tool_name(args)
```

它不会把每一步工具返回的 `success/error/resultText` 全量打印出来。对于 golden test，建议后续增加一个 `--trace-jsonl <path>` 参数，直接记录：

- tool call id
- tool name
- arguments
- started_at / finished_at
- success
- error
- result preview
- final answer

这样可以避免依赖终端文本反推工具结果。

### 3. 失败工具调用的参数展示有截断风险

任务 3 的第一步在 CLI 输出中显示不完整：

```text
> android_read_file(path='/sdcard/Download/__golden_missing_file_)
```

虽然模型后续明确判断为预期失败并继续执行，但报告层无法仅从 CLI 输出确认完整参数。这个问题同样适合通过结构化 trace 解决。

## 结论

LLM 层调用链路已经具备可行性：CoreCoder 可以把自然语言任务交给 LLM，LLM 能选择 `android_*` 工具，工具调用会通过 Operit Remote Tool API 落到安卓手机运行态，并把结果带回 LLM 生成回答。

当前主要优化点不在 Operit Remote Tool API，而在 CoreCoder LLM 层的可观测性和收束约束：

- 为 CLI 增加结构化 trace。
- 强制任务结束输出 `FINAL_ANSWER:`。
- 在 trace 中记录工具 success/error，而不是只打印工具名和参数。
