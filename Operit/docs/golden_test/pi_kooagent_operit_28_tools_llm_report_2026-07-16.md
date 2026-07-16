# Pi + kooagent-operit 28 工具真实设备 LLM 验收报告

日期：2026-07-16

## 1. 验收目标

验证以下完整链路：

```text
Pi 0.80.7 + Kimi K2.6
-> KooAgent 项目级 kooagent-operit extension
-> HTTP Remote Tool API
-> adb forward tcp:8094 tcp:8094
-> Operit Android Runtime
-> Android 真机工具执行
-> 结构化 ToolResult
-> Pi Agent Loop 继续推理并收束
```

本次不仅检查工具目录和 HTTP 接口，还要求 LLM 实际生成并执行全部 28 种 `android_*` 工具调用。

## 2. 测试环境

- Android 设备：Xiaomi `25098RA98C`
- Operit 包：`com.ai.assistance.operit`
- Operit Provider：`com.ai.assistance.operit.provider`
- Pi 源码版本：`0.80.7`
- Pi 模型：`moonshotai-cn/kimi-k2.6`
- thinking level：`medium`
- KooAgent extension commit：`fccdaa2a`
- Operit health：`{"success":true,"status":"ok"}`
- Operit `/api/device/tools`：返回 28 个工具，和 extension 工具目录一致

鉴权 token、应用列表、页面树、记忆内容和完整 LLM trace 未写入仓库。

## 3. 执行方式

### 3.1 确定性工具矩阵

先逐个直接调用 Remote Tool API，排除 LLM 规划波动。

第一次运行发现 Operit Provider 无障碍服务未启用：

```text
PASS=17
WARN=1
FAIL=10
```

临时启用正确的无障碍服务后重新执行：

```text
PASS=25
WARN=2
FAIL=1
```

### 3.2 Pi + LLM 完整运行

限制模型只使用项目级 `android_*` 工具，并要求维护 28 项 checklist。

实际 trace 统计：

```text
tool_execution_start = 28
tool_execution_end   = 28
不同工具名称          = 28
Agent turns          = 9
进程退出码            = 0
本次模型费用          = $0.037888
```

每种工具恰好被 LLM 调用一次。模型在部分工具返回错误后继续执行，最终输出 28 项汇总，没有提前终止。

## 4. 工具结果

| 工具 | 结果 | 说明 |
|---|---|---|
| `android_list_installed_apps` | PASS | 成功返回第三方应用清单 |
| `android_start_app` | PASS | 成功请求启动 Android Settings |
| `android_capture_screenshot` | PASS | 成功返回受控临时截图路径 |
| `android_get_page_info` | PASS | 成功返回当前应用和 UI 树 |
| `android_tap` | PASS | 无障碍坐标点击成功 |
| `android_long_press` | PASS | 无障碍长按成功 |
| `android_swipe` | PASS | 无障碍滑动成功 |
| `android_click_element` | PASS | 成功点击桌面搜索框 bounds |
| `android_set_input_text` | PASS/WARN | LLM 运行时焦点丢失而失败；单独构造桌面搜索输入焦点后成功写入 |
| `android_press_key` | PASS | `KEYCODE_HOME/BACK` 成功 |
| `android_run_ui_subagent` | BLOCKED | UI Controller 当前模型未启用图片理解，工具明确拒绝执行 |
| `android_sleep` | PASS | LLM 自主调用并返回精确 sleep 结果 |
| `android_use_package` | PASS/WARN | 使用已启用的 `browser` package 成功；另发现 inactive subpackage 的成功标志错误 |
| `android_make_directory` | PASS | 只在专用测试目录创建 |
| `android_create_file` | PASS | 成功创建测试文本 |
| `android_apply_file` | PASS | `type=create` 成功 |
| `android_edit_file` | PASS | 精确替换 `alpha beta -> gamma beta` 成功 |
| `android_list_files` | PASS | 成功列出测试目录 |
| `android_read_file` | PASS | 成功读回修改后的内容 |
| `android_read_file_part` | PASS | 成功读取第 1-2 行 |
| `android_find_files` | PASS | 成功找到两个 `*.txt` 文件 |
| `android_grep_code` | PASS | 成功定位 `gamma` |
| `android_grep_context` | PASS | 成功按 intent 定位 `gamma beta` |
| `android_visit_web` | PASS | 成功访问 `https://example.com` |
| `android_download_file` | PASS | 成功下载到专用测试目录 |
| `android_query_memory` | PASS | 正常返回空结果和 snapshot 元数据 |
| `android_get_memory_by_title` | EXPECTED_ERROR | 当前记忆库没有可用测试 fixture；不存在标题返回明确 `Memory not found` |
| `android_delete_file` | PASS | 只删除测试下载文件；最终测试目录也已清理 |

## 5. Pi extension 验证

LLM smoke 中观察到：

```text
Pi toolCallId: android_sleep_0
Operit requestId: android_sleep_0
Operit toolName: sleep
success: true
latencyMs: 18
Pi toolResult isError: false
```

说明 extension 已正确完成：

- `android_*` 名称到 Operit 原始名称的映射
- Bearer token 鉴权
- 参数转换为 `Map<String, String>`
- Pi AbortSignal 和 timeout 传递
- `toolCallId -> requestId` 关联
- Operit 完整响应写入 Pi tool result `details`
- 工具完成后模型继续下一轮并生成最终答案

## 6. 发现的问题

### P0：`use_package` 的业务失败可能返回 `success=true`

使用未启用的 `ctx_limiter_c` 时，Operit 返回：

```text
success = true
resultText = ToolPkg container 'com.operit.context_limiter_c' is not enabled.
             Package 'ctx_limiter_c' is inactive.
```

`PackageManager.executeUsePackageTool(...)` 只对少数前置错误返回 `success=false`，而 `usePackage(...)` 返回的其他失败文本仍被包装成成功结果。Pi extension 只能相信结构化 `success`，因此会把该业务失败当成正常结果。

建议：把 `usePackage` 改为结构化结果，或至少在 `executeUsePackageTool` 中为 inactive、not found、missing env 和 load failure 返回 `success=false`。

### P1：`run_ui_subagent` 缺少可用视觉模型

错误：

```text
当前 UI 控制器模型未启用识图能力
```

Remote Tool API 和 extension 分发正常，但设备当前功能模型配置无法满足该工具前置条件。配置一个支持图片理解的 UI Controller 模型后需要补测。

### P1：`set_input_text` 强依赖实时输入焦点

LLM 在点击桌面搜索框后到输入调用之间发生页面/焦点变化，导致一次失败。单独重现时，在确认搜索输入框获得焦点后调用成功。

后续 Agent 应在输入前通过页面树确认 editable/focused 状态，而不是只根据前一步点击成功推断。

### P2：缺少固定记忆 fixture

`query_memory` 能正常查询和返回空集，但当前无法验证 `get_memory_by_title` 的成功读取路径。建议在测试设备创建一条专用、无隐私内容的固定记忆。

## 7. 最终结论

### Overall：WARN

- 28 个 extension 工具均能被 Pi 发现并由 LLM 实际调用。
- 26 个工具已验证成功执行路径。
- `get_memory_by_title` 已验证稳定失败语义，但缺少成功 fixture。
- `run_ui_subagent` 被设备当前视觉模型配置阻塞。
- `use_package` 存在真实的结构化成功语义缺陷，需要修复。

因此当前不能声称“28 个工具全部正常”。更准确的结论是：

> Pi -> kooagent-operit -> Operit -> Android 真机的 28 工具调用链路已经完整打通；26 个工具具备已验证成功路径，1 个缺少测试数据，1 个受功能模型配置阻塞，并发现 1 个 Operit `use_package` 错误分类问题。

## 8. 现场清理

- `/sdcard/Download/KooAgentToolTest` 已删除
- `/sdcard/Download/KooAgentToolTestLLM` 已删除
- 手机已返回桌面
- Operit Provider 无障碍服务已恢复到测试前状态
- 临时 Bearer token 文件已清空
