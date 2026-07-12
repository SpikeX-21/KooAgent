# CoreCoder LLM 层 Internal UI Tools Golden Test 报告

日期：2026-07-12

## 测试目标

本次测试验证 `SystemToolPromptsInternal.kt` 中 `Internal UI Tools` 分类的全部工具，是否已经可以通过 CoreCoder LLM 层真实调用到 Android 运行态。

覆盖工具：

```text
get_page_info
tap
long_press
swipe
click_element
set_input_text
press_key
capture_screenshot
run_ui_subagent
```

CoreCoder 侧对应工具名：

```text
android_get_page_info
android_tap
android_long_press
android_swipe
android_click_element
android_set_input_text
android_press_key
android_capture_screenshot
android_run_ui_subagent
```

测试链路：

```text
自然语言任务
-> CoreCoder agent loop
-> LLM 生成 android_* tool call
-> CoreCoder AndroidRemoteTool / OperitDeviceClient
-> HTTP POST http://127.0.0.1:8094/api/device/tool-call
-> adb forward tcp:8094 tcp:8094
-> 手机上的 Operit Remote Tool API
-> Operit Internal UI Tools
-> tool result 返回给 LLM
-> FINAL_ANSWER
```

Trace 文件：

- `Operit/docs/golden_test/golden_traces/corecoder_llm_internal_ui_tools_2026-07-12.jsonl`

## 环境检查

手机端 `/api/device/health` 返回：

```json
{"success":true,"status":"ok"}
```

手机端 `/api/device/tools` 已包含全部 Internal UI Tools：

```text
capture_screenshot, click_element, get_page_info, long_press,
press_key, run_ui_subagent, set_input_text, swipe, tap
```

CoreCoder 侧也已暴露全部 `android_*` 工具。

## 任务 1：截图、页面信息、返回键

自然语言任务要求 LLM 依次调用：

```text
android_capture_screenshot()
android_get_page_info(format='json', detail='summary')
android_press_key(key_code='KEYCODE_BACK')
```

CoreCoder CLI 观察：

```text
> android_capture_screenshot()
> android_get_page_info(format='json', detail='summary')
> android_press_key(key_code='KEYCODE_BACK')
FINAL_ANSWER: 三个 Android Runtime 远程工具均已成功完成
```

Trace 结果：

| 工具 | 结果 |
| --- | --- |
| `android_capture_screenshot` | 成功，返回 `/storage/emulated/0/Download/Operit/cleanOnExit/2667.png` |
| `android_get_page_info` | 成功，返回当前应用和 UI 元素层级 |
| `android_press_key` | 成功，返回键通过 accessibility service 执行 |

状态：通过。

## 任务 2：手势类工具

自然语言任务要求 LLM 在设置页验证手势工具：

```text
android_start_app(package_name='com.android.settings')
android_tap(x=10, y=10)
android_long_press(x=10, y=10)
android_swipe(start_x=500, start_y=1600, end_x=500, end_y=1000, duration=300)
android_capture_screenshot()
```

其中 `android_start_app` 不属于 Internal UI Tools，但用于进入相对安全的设置页。

CoreCoder CLI 观察：

```text
> android_start_app(package_name='com.android.settings')
> android_tap(x=10, y=10)
> android_long_press(x=10, y=10)
> android_swipe(start_x=500, start_y=1600, end_x=500, end_y=1000, duration=300)
> android_capture_screenshot()
FINAL_ANSWER: 手势类 UI 工具 golden test 任务 2 完成验证
```

Trace 结果：

| 工具 | 结果 |
| --- | --- |
| `android_start_app` | 成功启动 `com.android.settings` |
| `android_tap` | 成功点击 `(10, 10)` |
| `android_long_press` | 成功长按 `(10, 10)` |
| `android_swipe` | 成功从 `(500,1600)` 滑动到 `(500,1000)` |
| `android_capture_screenshot` | 成功，返回 `/storage/emulated/0/Download/Operit/cleanOnExit/5752.png` |

状态：通过。

## 任务 3：失败不中断流程

自然语言任务要求 LLM 调用：

```text
android_click_element(bounds='[0,0][1,1]')
android_set_input_text(text='golden test')
android_run_ui_subagent(intent='只观察当前页面并给出一句摘要，不要点击，不要输入，不要修改任何设置', max_steps=1, target_app='com.android.settings')
android_capture_screenshot()
```

CLI 最终回答摘要：

```text
FINAL_ANSWER: 任务3已完成，共执行4个步骤，无论失败都继续执行后续步骤。
成功：android_click_element, android_capture_screenshot
失败：android_set_input_text, android_run_ui_subagent
```

Trace 结果显示，LLM 实际执行了两轮相同工具调用。每轮包含 4 个 tool call：

| 工具 | 结果 |
| --- | --- |
| `android_click_element` | 成功，点击 bounds `[0,0][1,1]` |
| `android_set_input_text` | 失败，`No focused editable field found.` |
| `android_run_ui_subagent` | 失败，UI 控制器模型未启用识图能力 |
| `android_capture_screenshot` | 成功，第二轮返回 `/storage/emulated/0/Download/Operit/cleanOnExit/1465.png` |

状态：通过，但包含 LLM 层重复调用现象。

失败语义符合预期：

- `set_input_text` 在没有聚焦输入框时返回结构化错误。
- `run_ui_subagent` 在 UI 控制器模型未启用识图能力时返回结构化错误。
- 这些失败没有导致 CoreCoder 进程或 Operit server 崩溃。
- LLM 最终仍输出了 `FINAL_ANSWER`。

## 覆盖情况

| Internal UI Tool | LLM 层是否触发 | 结果 |
| --- | --- | --- |
| `capture_screenshot` | 是 | 成功 |
| `get_page_info` | 是 | 成功 |
| `press_key` | 是 | 成功 |
| `tap` | 是 | 成功 |
| `long_press` | 是 | 成功 |
| `swipe` | 是 | 成功 |
| `click_element` | 是 | 成功 |
| `set_input_text` | 是 | 工具链路可达，因无输入焦点失败 |
| `run_ui_subagent` | 是 | 工具链路可达，因 UI 控制器模型未启用识图能力失败 |

全部 9 个 Internal UI Tools 均已通过 LLM 层触发到 Android runtime。

## 发现的问题

### 1. 多 tool call 会被 CoreCoder 并行执行

任务 3 的 prompt 要求“按顺序调用”，但 LLM 一次返回多个 tool calls 时，CoreCoder 会并行执行这些工具。

这符合当前 CoreCoder 的 agent loop 设计，但对 UI 操作类工具存在风险：UI 操作通常有顺序依赖，例如先点击输入框，再输入文本。

建议后续对 UI 工具增加一种执行约束：

```text
UI 工具调用默认串行执行，或者标记某些工具为 non_parallel。
```

### 2. LLM 重复执行了任务 3 的同一组工具

Trace 显示任务 3 第一轮已经完成 4 个工具调用，但 LLM 第二轮又重复执行了一遍同样的 4 个工具，之后才输出 `FINAL_ANSWER`。

这说明只靠 prompt 约束还不足以保证 golden test 的最小步数和无重复执行。建议后续在 harness 层增加：

- `max_steps`
- `required_tools`
- `forbidden_duplicate_tool_signature`
- `stop_when_required_tools_observed`

### 3. `set_input_text` 成功路径仍需专门输入框场景

当前测试验证了失败路径和错误结构，但没有验证成功输入。成功路径需要一个确定可聚焦的输入框，例如：

- 专用测试 Activity，只有一个 EditText。
- Operit 内部 debug 输入页。
- 已知应用的搜索框，并先通过 `get_page_info` 确认输入框聚焦。

### 4. `run_ui_subagent` 依赖 UI 控制器模型配置

当前失败原因是：

```text
当前 UI 控制器模型未启用识图能力
```

这不是 Remote Tool API 链路失败，而是运行时功能模型配置不足。后续需要配置支持图片理解的 UI 控制器模型，再做成功路径测试。

## 总体结论

本次 LLM 层 golden test 通过。

核心结论：

- CoreCoder 已经能向 LLM 暴露全部 Internal UI Tools。
- LLM 可以真实生成 `android_*` 工具调用。
- 这些调用可以经由 Remote Tool API 到达手机上的 Operit Android runtime。
- 9 个 Internal UI Tools 全部被触发。
- 成功工具返回正常结果。
- 失败工具返回结构化错误，且不会中断 CoreCoder / Operit 流程。

当前主要后续工作不是“工具是否接通”，而是 UI agent loop 的执行策略：

- UI 工具应考虑串行执行。
- Golden harness 应能限制重复工具调用。
- `set_input_text` 和 `run_ui_subagent` 需要配置确定成功场景后再补成功路径测试。
