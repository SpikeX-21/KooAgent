# UI/App Remote Tools Golden Test 报告

日期：2026-07-12

## 测试目标

本次验证新加入 Remote Tool API allowlist 的 UI/App 工具是否已经在真实 Android 设备上生效：

- `start_app`
- `capture_screenshot`
- `tap`
- `set_input_text`
- `press_key`

同时验证这些工具通过当前链路可以被远程调用：

```text
Mac host
-> HTTP POST http://127.0.0.1:8094/api/device/tool-call
-> adb forward tcp:8094 tcp:8094
-> 手机上的 Operit ExternalChatHttpServer
-> RemoteToolApiHandler
-> AIToolHandler.executeTool(...)
-> Operit UI/App 内置工具
-> HTTP JSON 返回
```

Trace 文件：

- `Operit/docs/golden_test/golden_traces/ui_remote_tools_golden_2026-07-12.jsonl`

## 环境检查

健康检查通过：

```json
{"success":true,"status":"ok"}
```

工具清单已经包含新增工具：

```text
capture_screenshot, press_key, set_input_text, start_app, tap
```

说明用户手动安装的新 APK 已经生效。

## 任务 1：启动设置、截图、返回、再截图

自然语言目标：

```text
打开 Android 设置页，确认可以截图，再用返回键退出并再次截图。
```

执行步骤：

| 步骤 | 工具 | 参数 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| 1 | `start_app` | `package_name=com.android.settings` | 成功启动设置 | 42 ms |
| 2 | `capture_screenshot` | `{}` | 成功，返回 `/storage/emulated/0/Download/Operit/cleanOnExit/4276.png` | 587 ms |
| 3 | `press_key` | `key_code=KEYCODE_BACK` | 成功通过 accessibility service 按返回键 | 70 ms |
| 4 | `capture_screenshot` | `{}` | 成功，返回 `/storage/emulated/0/Download/Operit/cleanOnExit/7631.png` | 465 ms |

状态：通过。

## 任务 2：tap 与无焦点输入失败语义

自然语言目标：

```text
验证 tap 可以执行；验证 set_input_text 在没有可编辑焦点时不会导致服务崩溃。
```

执行步骤：

| 步骤 | 工具 | 参数 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| 1 | `tap` | `x=10, y=10` | 成功点击坐标 `(10, 10)` | 71 ms |
| 2 | `set_input_text` | `text=operit golden test` | 结构化失败：`No focused editable field found.` | 69 ms |

状态：通过，包含一个预期焦点失败。

说明：`set_input_text` 依赖当前 UI 中已经存在聚焦的可编辑输入框。当前没有焦点时返回 `success=false` 和明确错误，符合工具级失败语义。

## 任务 3：尝试聚焦设置搜索框后输入

自然语言目标：

```text
尝试打开设置页，点击搜索区域并输入文本；如果无法形成输入焦点，后续工具仍应继续执行。
```

执行步骤：

| 步骤 | 工具 | 参数 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| 1 | `start_app` | `package_name=com.android.settings` | 成功启动设置 | 37 ms |
| 2 | `tap` | `x=900, y=140` | 成功点击坐标 `(900, 140)` | 77 ms |
| 3 | `set_input_text` | `text=wifi` | 结构化失败：`No focused editable field found.` | 71 ms |
| 4 | `press_key` | `key_code=KEYCODE_BACK` | 成功按返回键 | 71 ms |
| 5 | `capture_screenshot` | `{}` | 成功，返回 `/storage/emulated/0/Download/Operit/cleanOnExit/5654.png` | 461 ms |

状态：通过，包含一个焦点依赖失败。

说明：当前坐标点击没有让设置页搜索框进入可编辑焦点，因此 `set_input_text` 未能成功输入。该失败是 UI 状态依赖，不是 Remote Tool API 或工具分发崩溃。失败后 `press_key` 和 `capture_screenshot` 继续成功执行。

## 总体结论

新 APK 中 UI/App 工具 allowlist 已生效，真实设备远程调用结果如下：

| 工具 | 真实调用结果 |
| --- | --- |
| `start_app` | 成功 |
| `capture_screenshot` | 成功 |
| `tap` | 成功 |
| `press_key(KEYCODE_BACK)` | 成功 |
| `set_input_text` | 远程调用成功到达工具层；当前无可编辑焦点时返回结构化失败 |

本次 golden test 的核心结论：

- Remote Tool API 已经暴露并允许调用新增 UI/App 工具。
- `start_app`、`capture_screenshot`、`tap`、`press_key` 在真实手机上可用。
- `set_input_text` 的调用链路可达，失败时返回结构化错误，不会导致服务崩溃。
- 工具失败后后续工具仍可继续执行。

## 后续建议

下一轮如需验证 `set_input_text` 的成功路径，建议使用一个确定可聚焦的输入场景，例如：

- 打开一个专门的测试 Activity，里面只有一个 EditText。
- 或在 Operit 内增加一个安全的 UI debug 输入页。
- 或用 `start_app` 打开已知应用的搜索页，并通过截图确认输入框已经聚焦后再调用 `set_input_text`。

这样可以把“工具链路是否可用”和“当前 UI 是否有可编辑焦点”两个问题拆开验证。
