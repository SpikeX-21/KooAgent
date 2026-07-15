# Operit Remote Tool API 与 CoreCoder 最小联调

本文记录当前最小闭环的完整调试流程：

```text
CoreCoder
  -> POST /api/device/tool-call
  -> Operit Android Runtime
  -> list_installed_apps
  -> ToolResult.resultText
  -> CoreCoder tool result
```

当前最小暴露工具为：

```text
list_installed_apps
```

选择它是因为它不依赖坐标、截图文件、当前前台页面或输入焦点，最适合验证端云工具调用链路。

## 1. 环境规则

Operit Android 编译和测试必须使用 Android Studio 自带 JDK 21：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

示例：

```bash
cd /Users/spike21/workspace/code/kooagent/Operit
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:compileDebugKotlin
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
```

CoreCoder 使用 `corecoder` conda 环境：

```bash
cd /Users/spike21/workspace/code/kooagent/CoreCoder
conda activate corecoder
```

非交互 shell 推荐：

```bash
conda run -n corecoder python -m pytest tests/test_android_remote_tool.py -q
```

## 2. 构建 Operit APK

在 Operit 仓库执行：

```bash
cd /Users/spike21/workspace/code/kooagent/Operit
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
```

常用调试 APK 输出路径通常是：

```text
app/build/outputs/apk/debug/app-debug.apk
```

如果使用 clone 构建：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebugClone
```

clone APK 输出文件名由 Gradle 配置生成，通常在：

```text
app/build/outputs/apk/clone/app-clone.apk
```

## 3. 安装到安卓手机

确保手机开启开发者选项和 USB 调试，然后连接 USB：

```bash
adb devices
```

安装 debug APK：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

如果安装 clone APK：

```bash
adb install -r app/build/outputs/apk/clone/app-clone.apk
```

安装后打开 Operit。第一次运行如果系统要求通知、悬浮窗、无障碍、Shizuku/root 等权限，先按当前调试目标处理。`list_installed_apps` 不需要 UI 操作权限，但后续调试 `tap`、`capture_screenshot`、`get_page_info` 会依赖对应运行时权限。

## 4. 开启外部 HTTP API 并获取 token

Token 位于 Operit 的外部 HTTP API 设置页。源码位置：

```text
app/src/main/java/com/ai/assistance/operit/ui/features/settings/screens/ExternalHttpChatSettingsScreen.kt
```

获取方式：

1. 打开 Operit。
2. 进入设置里的外部 HTTP API / External HTTP Chat 页面。
3. 打开启用开关。
4. 如果还没有 token，打开开关时会调用 `ensureBearerToken()` 自动生成。
5. 在 token 区域点击“复制 token”。
6. 如需换 token，点击“重置 token”，新 token 会自动复制到剪贴板。

实现细节：

- token 存在 `ExternalHttpApiPreferences` 的 `external_http_api_bearer_token`。
- 端口默认是 `8094`。
- 服务端校验 `Authorization: Bearer <token>`。
- token 生成逻辑是 `UUID.randomUUID().toString().replace("-", "")`。

如果你不想用自动生成，也可以在设置页手动输入 token 并保存，但长度不能小于 6。

## 5. 连接方式

### 5.1 USB ADB forward

这是最稳定的本地调试方式：

```bash
adb forward tcp:8094 tcp:8094
```

然后电脑访问：

```text
http://127.0.0.1:8094
```

### 5.2 局域网

设置页会显示局域网访问地址，例如：

```text
http://192.168.x.x:8094
```

电脑和手机需要在同一网络，并且网络不能阻止局域网互访。

## 6. 用 curl 验证 Operit Remote Tool API

设置变量：

```bash
export OPERIT_URL="http://127.0.0.1:8094"
export OPERIT_TOKEN="从设置页复制的token"
```

验证 health：

```bash
curl -H "Authorization: Bearer $OPERIT_TOKEN" \
  "$OPERIT_URL/api/device/health"
```

验证工具列表：

```bash
curl -H "Authorization: Bearer $OPERIT_TOKEN" \
  "$OPERIT_URL/api/device/tools"
```

预期 `allowlist` 至少包含：

```text
list_installed_apps
```

调用最小工具：

```bash
curl -X POST "$OPERIT_URL/api/device/tool-call" \
  -H "Authorization: Bearer $OPERIT_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "requestId": "req-list-apps-001",
    "taskId": "debug-remote-tool",
    "stepIndex": 1,
    "toolName": "list_installed_apps",
    "arguments": {}
  }'
```

成功响应会包含：

```json
{
  "toolName": "list_installed_apps",
  "success": true,
  "resultText": "...",
  "latencyMs": 123
}
```

如果 token 错误，会返回 `401 Unauthorized`。

如果调用未放入 allowlist 的工具，会返回 `403 Forbidden`。

## 7. CoreCoder 直接调用 Operit

CoreCoder 仓库位置：

```text
/Users/spike21/workspace/code/kooagent/CoreCoder
```

先进入环境：

```bash
cd /Users/spike21/workspace/code/kooagent/CoreCoder
conda activate corecoder
```

直接 smoke test：

```bash
OPERIT_URL="http://127.0.0.1:8094" \
OPERIT_TOKEN="从设置页复制的token" \
python examples/operit_list_apps.py
```

这个脚本会创建 `AndroidRemoteTool`，调用：

```text
POST /api/device/tool-call
toolName = list_installed_apps
```

并把 Operit 返回的 `resultText` 打印出来。

## 8. CoreCoder Agent 中启用 Operit 工具

CoreCoder 默认工具不变。只有显式传入 Operit URL 和 token 时，才会额外暴露：

```text
android_list_installed_apps
```

示例：

```bash
conda run -n corecoder corecoder \
  --operit-url "http://127.0.0.1:8094" \
  --operit-token "从设置页复制的token" \
  -p "调用安卓工具列出已安装应用"
```

也可以用环境变量：

```bash
export OPERIT_URL="http://127.0.0.1:8094"
export OPERIT_TOKEN="从设置页复制的token"

conda run -n corecoder corecoder \
  -p "调用安卓工具列出已安装应用"
```

注意：CoreCoder 仍需要模型 API 配置，例如：

```bash
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="..."
export CORECODER_MODEL="..."
```

## 9. 本地验证命令

Operit focused unit test：

```bash
cd /Users/spike21/workspace/code/kooagent/Operit
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew :app:testDebugUnitTest --tests com.ai.assistance.operit.integrations.http.RemoteToolApiModelsTest
```

Operit Kotlin compile：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew :app:compileDebugKotlin
```

CoreCoder focused tests：

```bash
cd /Users/spike21/workspace/code/kooagent/CoreCoder
conda run -n corecoder python -m pytest \
  tests/test_tools.py::test_tool_count \
  tests/test_android_remote_tool.py \
  -q
```

## 10. 常见问题

### 10.1 401 Unauthorized

检查：

- 是否复制的是外部 HTTP API 页面里的 bearer token。
- curl/header 是否是 `Authorization: Bearer <token>`。
- token 是否被重置过。

### 10.2 连接被拒绝

检查：

- Operit 外部 HTTP API 是否启用。
- 设置页状态是否显示服务正在运行。
- 端口是否是 `8094`。
- USB 调试时是否执行过 `adb forward tcp:8094 tcp:8094`。
- 局域网调试时电脑和手机是否在同一网络。

### 10.3 Gradle 出现 class file version 65 / expected 61

说明当前用了 JDK 17。必须切到 Android Studio 自带 JDK 21：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:compileDebugKotlin
```

### 10.4 CoreCoder 找不到 pytest 或依赖

使用 `corecoder` conda 环境：

```bash
conda activate corecoder
python -m pytest tests/test_android_remote_tool.py -q
```

非交互 shell：

```bash
conda run -n corecoder python -m pytest tests/test_android_remote_tool.py -q
```

### 10.5 list_installed_apps 成功，但 tap/screenshot 失败

当前最小闭环只验证 `list_installed_apps`。后续扩展到 UI 工具时，需要额外确认：

- 无障碍/截图/悬浮窗权限。
- Shizuku/root/debugger 权限模式。
- Operit 工具权限系统中对应工具是否允许执行。
- Android 侧 allowlist 是否加入目标工具。

## 11. 下一步扩展建议

最小闭环稳定后，再逐个加入工具：

```text
get_page_info
capture_screenshot
press_key
tap
set_input_text
swipe
start_app
```

每次只加一个工具，并为 CoreCoder adapter 增加一条 focused test。
