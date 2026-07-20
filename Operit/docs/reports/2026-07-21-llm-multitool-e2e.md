# LLM → Pi → Operit → Android 多工具端到端测试报告

## 结论

通过。真实 LLM 在 pi-agent 中完成了 3 个连续、不同类型的 Extension 工具调用；每一步的 Operit v2 outcome 均为 `SUCCEEDED`，结果被 Extension 写入 Pi 的 `ToolResultMessage`，模型据此继续下一步，并在第三步后正常给出最终回答。

执行时间：2026-07-21 00:31（Asia/Shanghai；原始 session 时间为 `2026-07-20T16:31Z`）

## 测试范围

链路：

```text
用户提示 → kimi-k2.7-code-highspeed → pi-agent tool loop
  → kooagent-operit Extension → Operit HTTP v2 → Android executor
  → v2 outcome → Extension content/details → Pi toolResult → LLM 下一轮
```

本次只启用 Extension 工具（`--no-builtin-tools`），并通过 ADB 将本机 `8094` 转发到已安装测试 APK 的 Android 设备。提示要求模型严格按顺序调用：

1. `android_list_installed_apps`
2. `android_query_memory({ query: "Operit" })`
3. `android_sleep({ duration_ms: 100 })`

模型实际遵守了该顺序，没有调用其他工具。

## 执行身份与 Trace

| 字段 | 值 |
| --- | --- |
| Pi session ID | `operit-llm-e2e-20260721` |
| Operit run ID | `c3d89a0f-9b88-4a81-ac85-0fe68f34dbe3` |
| **trace ID** | **`48d382bd501749e887e2a3bc275356d5`** |
| 模型 | `moonshotai-cn/kimi-k2.7-code-highspeed` |
| 工具调用总数 | `3` |
| 工具执行总耗时 | `312 ms` |
| LLM 从首个请求到最终回答 | 约 `3.5 s` |

Trace 原始 JSONL：`/tmp/operit-llm-e2e-20260721.jsonl`（3 条完成事件）。

## 调用明细

| 顺序 | Pi 本地工具 | Operit 工具 | toolCallId | executionId | status | 传输尝试 | executor 耗时 | 结果摘要 |
| ---: | --- | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | `android_list_installed_apps` | `list_installed_apps` | `android_list_installed_apps_0` | `df71c4b3-22b2-4aa3-ad4b-31fa7b919fbf` | `SUCCEEDED` | 1 | 187 ms | 返回第三方应用列表，包含 Operit AI、QQ、Termux 等。 |
| 2 | `android_query_memory` | `query_memory` | `android_query_memory_1` | `927c3f5a-c09d-413b-9b7f-314d0e025e24` | `SUCCEEDED` | 1 | 17 ms | 使用 `query: "Operit"` 创建 snapshot；未发现相关记忆。 |
| 3 | `android_sleep` | `sleep` | `android_sleep_2` | `2eeb44d7-0c9d-4634-926e-a385de25778c` | `SUCCEEDED` | 1 | 108 ms | 成功等待 100 ms。 |

三个 outcome 均携带同一个 `traceId` 和 `runId`，但拥有各自独立的 `toolCallId`、`executionId` 及递增 `turnIndex`（0、1、2）。

## 关键链路证据

1. LLM 第一轮生成 `android_list_installed_apps` tool call。
2. Extension 将 Android 返回映射为 `role: "toolResult"`；其中 `details.kind = "operit-tool-result"`、`details.outcome.status = "SUCCEEDED"`、`isError = false`。
3. LLM 读取该 ToolResult 后生成第二轮 `android_query_memory({ query: "Operit" })`。
4. 第二个成功 ToolResult 进入上下文后，LLM 生成第三轮 `android_sleep({ duration_ms: 100 })`。
5. 第三个成功 ToolResult 返回后，LLM 正常 `stop` 并报告“三个工具均成功”。

这验证了结果不是只停留在 Operit HTTP 响应，而是实际穿过了 Extension 的结果映射和 Pi 的多轮 Agent loop，并被后续 LLM 调用消费。

## LLM 最终回答

> 验证完成，共调用 3 个工具。
>
> 1. `android_list_installed_apps`：成功，返回设备第三方应用列表。
> 2. `android_query_memory`：成功，生成快照但未找到相关记忆。
> 3. `android_sleep`：成功，已休眠 100 毫秒。

## 复现命令

```bash
adb forward tcp:8094 tcp:8094
OPERIT_TRACE_FILE=/tmp/operit-llm-e2e-20260721.jsonl \
  ./pi/pi-test.sh --approve --no-builtin-tools \
  --model moonshotai-cn/kimi-k2.7-code-highspeed \
  --session-id operit-llm-e2e-20260721 \
  --session-dir /tmp/operit-llm-e2e-sessions \
  --print '<要求 LLM 依次调用三个 android_* 工具的测试提示>'
```

## 限制与备注

- 本次选择只读或无副作用工具，未执行 UI 写操作。
- 此前独立预检中 `capture_screenshot` 在该设备返回 `TOOL_EXECUTION_FAILED: Screenshot failed`，因此没有把截图纳入成功链路；这不影响本次 3 工具多步骤链路的通过结论。
- Trace JSONL 不写请求参数、完整结果或图像数据；详细工具结果保存在 Pi 临时 session JSONL 中：`/tmp/operit-llm-e2e-sessions/2026-07-20T16-31-25-593Z_operit-llm-e2e-20260721.jsonl`。
