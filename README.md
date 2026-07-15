# KooAgent

KooAgent 是一个用于验证“云端/桌面 agent 大脑 + Android 运行态工具系统”的集成仓库。

这个仓库把两个独立项目放在同一条集成线上：

- `CoreCoder`：最小 agent loop / agent 大脑示例，负责理解自然语言任务、生成 tool call、接收工具结果并继续推理。
- `Operit`：Android runtime 工具执行系统，负责在手机运行态执行文件、应用、网络、记忆库等工具。

项目目标不是把所有能力塞进一个 App，而是把职责拆开：

```text
Agent 大脑（CoreCoder / 云端 agent / 其他 LLM agent）
-> 远程工具调用协议
-> Android 运行态（Operit）
-> 手机上真实工具执行
-> 结构化结果返回给 Agent
-> Agent 继续规划或给出 final_answer
```

## 为什么这样设计

传统手机 AI 助手通常把“模型推理”和“设备执行”绑在同一个 Android 应用里。KooAgent 探索的是另一种形态：

- agent 大脑可以在云端、桌面或其他更强的执行环境中运行。
- Android 设备只承担运行态和工具执行职责。
- 工具能力通过远程 API 暴露，像本地函数一样被 agent 调用。
- 手机端保留对文件、应用、网络和设备上下文的真实访问能力。

这让 Operit 更像一个 Android runtime，而 CoreCoder 或其他 agent 则承担 planner / reasoning / orchestration 的角色。

## 当前链路

当前已验证的最小链路如下：

```text
电脑上的 CoreCoder
-> AndroidRemoteTool / OperitDeviceClient
-> HTTP POST http://127.0.0.1:8094/api/device/tool-call
-> adb forward tcp:8094 tcp:8094
-> 手机上的 Operit ExternalChatHttpServer
-> RemoteToolApiHandler
-> AIToolHandler.executeTool(...)
-> Operit 内置工具
-> ToolResult
-> HTTP JSON 返回给 CoreCoder
-> LLM 继续推理并输出 FINAL_ANSWER
```

已经验证过的工具包括：

- `list_files`
- `find_files`
- `read_file`
- `read_file_part`
- `sleep`
- `list_installed_apps`

CoreCoder 侧暴露给 LLM 的工具名使用 `android_` 前缀，例如：

```text
android_list_files
android_find_files
android_read_file
android_read_file_part
android_sleep
```

## 仓库结构

```text
KooAgent/
  CoreCoder/   # agent loop 与远程 Android 工具 SDK
  Operit/      # Android runtime 与 Remote Tool API
```

两个目录仍然保留各自原项目的 Git 历史和开发节奏。`SpikeX-21/KooAgent` 用作集成与备份仓库。

## 分支约定

当前集成线使用：

```text
feature/remote-tool-minimal-loop
```

由于 `Operit` 和 `CoreCoder` 是两个独立代码库，在 `SpikeX-21/KooAgent` 中使用项目前缀分支：

```text
operit/feature-remote-tool-minimal-loop
corecoder/feature-remote-tool-minimal-loop
```

顶层 `main` 分支用于保存稳定的集成快照。

详细 Git 规范见：

- [`GIT_MANAGEMENT.md`](GIT_MANAGEMENT.md)

## 快速运行链路

### 1. 启动手机侧 Operit

在 Android 手机上安装并打开 Operit，开启外部 HTTP 调用能力，获取 token。

通过 adb 转发端口：

```bash
adb forward tcp:8094 tcp:8094
```

检查手机侧 Remote Tool API：

```bash
curl -H "Authorization: Bearer <OPERIT_TOKEN>" \
  http://127.0.0.1:8094/api/device/health
```

### 2. 在 CoreCoder 中调用 Android 工具

CoreCoder 必须在 `corecoder` conda 环境中运行：

```bash
conda activate corecoder
cd CoreCoder

corecoder \
  --operit-url "http://127.0.0.1:8094" \
  --operit-token "<OPERIT_TOKEN>" \
  --trace-jsonl "/tmp/corecoder-operit-trace.jsonl"
```

一次性的 golden test 示例：

```bash
corecoder \
  --operit-url "http://127.0.0.1:8094" \
  --operit-token "<OPERIT_TOKEN>" \
  --trace-jsonl "/tmp/corecoder-operit-trace.jsonl" \
  -p "请只使用 Android Runtime 远程工具，检查 /sdcard/Download/Operit 目录，并在最后输出 FINAL_ANSWER。"
```

## Trace 与测试报告

CoreCoder 支持：

```bash
--trace-jsonl <path>
```

它会记录 agent loop 里的关键事件：

- `tool_call_id`
- `tool_name`
- `arguments`
- `started_at`
- `finished_at`
- `success`
- `error`
- `result_preview`
- `final_answer`

这让 golden test 不再依赖终端输出反推工具结果，而是可以直接分析结构化 JSONL。

Operit 侧的测试报告和 trace 位于：

```text
Operit/docs/
Operit/docs/golden_traces/
```

## 当前验证状态

已经完成的验证：

- Remote Tool API 可以列出允许暴露的 Android 工具。
- CoreCoder 可以通过 LLM 生成 `android_*` 工具调用。
- 工具调用可以通过 adb forward 到达手机上的 Operit。
- 多步工具调用可以连续执行。
- 工具级失败不会导致 server 或 CoreCoder 崩溃。
- CoreCoder 可以写出 JSONL trace。

已发现的改进点：

- LLM 有时完成工具调用后没有输出明确 final answer，需要在 prompt 或 agent 约束中强化 `FINAL_ANSWER:` 收束格式。
- CLI 当前只展示工具名和参数，结构化 trace 已经补上结果观测能力。
- 后续可把 Remote Tool API 进一步抽象成 MCP/RPC 风格接口，让远程工具更像本地函数调用。

## 后续方向

短期目标：

- 扩大 Android 内置工具的 golden test 覆盖。
- 为写文件、下载、网页访问等高风险工具增加更严格的 allowlist 与 trace。
- 把 CoreCoder 的 trace schema 稳定下来，便于自动回归测试。

中期目标：

- 将 Operit 作为独立 Android runtime 暴露给更多 agent。
- 评估 MCP/RPC 风格协议封装，降低调用链路心智负担。
- 增加会话级权限、审计、失败恢复和工具结果脱敏。

长期目标：

- 让任意外部 agent 大脑都可以安全、可观测地调用 Android 运行态能力。
- 形成一套“云端智能 + 端侧执行”的开放实验框架。

## 开发备注

- Operit Android 编译/测试使用 Android Studio 自带 JDK 21。
- CoreCoder 运行使用 conda 环境 `corecoder`。
- 报告、调试记录和 golden test 文档默认使用中文。
