# Operit 工具参考手册

> 生成日期: 2026-07-15 | 分支: `feature/remote-tool-minimal-loop`

---

## 目录

1. [工具体系总览](#1-工具体系总览)
2. [内置默认工具](#2-内置默认工具)
   - [2.1 AI 可见工具（始终出现在 Prompt 中）](#21-ai-可见工具始终出现在-prompt-中)
   - [2.2 内部工具（Prompt 中作为扩展类别展示）](#22-内部工具prompt-中作为扩展类别展示)
   - [2.3 隐藏工具（不在 Prompt 中但已注册）](#23-隐藏工具不在-prompt-中但已注册)
   - [2.4 CLI 模式专有工具](#24-cli-模式专有工具)
3. [动态工具包](#3-动态工具包)
   - [3.1 默认启用的 JS 包](#31-默认启用的-js-包)
   - [3.2 需手动激活的 JS 包](#32-需手动激活的-js-包)
   - [3.3 ToolPkg 归档包](#33-toolpkg-归档包)
4. [其他动态工具来源](#4-其他动态工具来源)
   - [4.1 MCP 工具](#41-mcp-工具)
   - [4.2 Skill 技能](#42-skill-技能)
   - [4.3 PhoneAgent](#43-phoneagent)
5. [注册与激活流程](#5-注册与激活流程)

---

## 1. 工具体系总览

```
Operit 工具体系
├── 内置默认工具 (Kotlin 实现, 启动时注册, 113 个)
│   ├── AI 可见工具 (16 个) — 始终出现在系统 Prompt 中
│   ├── 内部工具 (90 个) — 在 Prompt 中作为扩展类别展示
│   └── 隐藏工具 (7 个) — 已注册但不在 Prompt 中
│
├── 动态工具包 (JavaScript/QuickJS, 按需加载, ~42 个)
│   ├── JS 单文件包 (~25 个)
│   └── ToolPkg 归档包 (~12 个)
│
├── MCP 工具 (远端服务, 按连接加载)
├── Skill 技能 (Markdown, 注入 Prompt 不注册工具)
└── PhoneAgent (AI 驱动的 UI 自动化代理)
```

### 关键概念

| 概念 | 说明 |
|------|------|
| **注册 (Register)** | 将工具名和 Executor 绑定到 `AIToolHandler.availableTools` |
| **Prompt 可见** | 工具的描述和参数 Schema 是否发送给 AI 模型 |
| **启用 (Enable)** | 动态包加入偏好设置启用列表，但工具尚未注册 |
| **激活/使用 (Use)** | 动态包调用 `usePackage()`，工具正式注册并可用 |
| **权限分级** | STANDARD → ACCESSIBILITY → DEBUGGER → ADMIN → ROOT |

---

## 2. 内置默认工具

**注册方式**: 启动时 `AIToolHandler.registerDefaultTools()` → `ToolRegistration.registerAllTools()`
**实现语言**: Kotlin
**命名格式**: 直接工具名 (如 `read_file`, `tap`)
**权限分发**: `ToolGetter` 根据当前权限等级返回对应实现

### 2.1 AI 可见工具（始终出现在 Prompt 中）

定义位置: `SystemToolPrompts.kt` → `getAIAllCategoriesEn/Cn()`

#### 基础工具 (Basic Tools)

| 工具名 | 说明 | 主要参数 |
|--------|------|---------|
| `sleep` | 暂停指定毫秒 | `duration_ms` (integer, 默认 1000) |
| `use_package` | 激活一个动态工具包 | `package_name` (string, 必需) |

#### 文件系统工具 (File System Tools)

| 工具名 | 说明 | 主要参数 |
|--------|------|---------|
| `list_files` | 列出目录内容 | `path` (必需), `environment` (可选) |
| `read_file` | 读取文件内容（图片自动 OCR） | `path` (必需), `environment`, `intent`, `direct_image`, `direct_audio`, `direct_video` |
| `read_file_part` | 按行号范围读取 | `path`, `start_line`, `end_line`, `environment` |
| `create_file` | 创建新文件 (委托 apply_file) | `path`, `new` (文件内容), `environment` |
| `edit_file` | 编辑现有文件 (委托 apply_file) | `path`, `old` (精确匹配), `new` (替换内容), `environment` |
| `delete_file` | 删除文件或目录 | `path`, `recursive` (boolean), `environment` |
| `make_directory` | 创建目录 | `path`, `create_parents` (boolean), `environment` |
| `find_files` | 搜索匹配模式的文件 | `path`, `pattern`, `max_depth`, `environment` |
| `grep_code` | 正则搜索代码内容 | `path`, `pattern` (regex), `file_pattern`, `context_lines`, `environment` |
| `grep_context` | 语义相关性搜索 | `path`, `intent`, `file_pattern`, `max_results`, `environment` |
| `download_file` | 下载文件（URL 或 visit_web 结果） | `url`/`visit_key`+`link_number`, `destination`, `environment` |

#### HTTP 工具 (HTTP Tools)

| 工具名 | 说明 | 主要参数 |
|--------|------|---------|
| `visit_web` | 访问网页并提取信息 | `url`/`visit_key`+`link_number`, `include_image_links`, `headers`, `user_agent_preset` |

#### 记忆库工具 (Memory Tools)

| 工具名 | 说明 | 主要参数 |
|--------|------|---------|
| `query_memory` | 搜索记忆库 | `query`, `folder_path`, `start_time`, `end_time`, `snapshot_id`, `threshold`, `limit` |
| `get_memory_by_title` | 按标题获取记忆 | `title` (必需), `chunk_index`, `chunk_range`, `query`, `limit` |

---

### 2.2 内部工具（Prompt 中作为扩展类别展示）

定义位置: `SystemToolPromptsInternal.kt` → 通过 `getAllCategoriesEn/Cn()` 追加到 Prompt

#### 2.2.1 内部工具 (Internal Tools / 内部工具) — 37 个

| 工具名 | 说明 |
|--------|------|
| `execute_shell` | 执行设备 Shell 命令 |
| `apply_file` | 对文件应用编辑（replace/delete/create） |
| `create_terminal_session` | 创建终端会话 |
| `execute_in_terminal_session` | 在终端会话中执行命令并收集输出 |
| `execute_hidden_terminal_command` | 在隐藏终端执行器中执行命令 |
| `input_in_terminal_session` | 向终端会话输入文本/控制键 |
| `close_terminal_session` | 关闭终端会话 |
| `get_terminal_session_screen` | 获取终端当前可见 PTY 屏幕内容 |
| `music_play` | 播放音频 |
| `music_play_queue` | 播放音频队列 |
| `music_pause` | 暂停音乐 |
| `music_resume` | 恢复音乐 |
| `music_stop` | 停止音乐 |
| `music_seek` | 跳转到指定位置 |
| `music_set_volume` | 设置播放音量 |
| `music_status` | 获取播放状态 |
| `browser_click` | 点击浏览器元素 |
| `browser_close` | 关闭当前浏览器标签页 |
| `browser_close_all` | 关闭所有浏览器标签页 |
| `browser_console_messages` | 读取浏览器控制台消息 |
| `browser_drag` | 拖拽浏览器元素 |
| `browser_evaluate` | 在当前页面执行 JavaScript |
| `browser_file_upload` | 处理文件选择器 |
| `browser_fill_form` | 批量填写表单字段 |
| `browser_handle_dialog` | 处理浏览器对话框 |
| `browser_hover` | 悬停在浏览器元素上 |
| `browser_navigate` | 导航到 URL |
| `browser_navigate_back` | 浏览器后退 |
| `browser_network_requests` | 读取网络请求列表 |
| `browser_press_key` | 按下键盘按键 |
| `browser_resize` | 调整浏览器视口大小 |
| `browser_run_code` | 执行 Playwright 风格代码 |
| `browser_select_option` | 选择下拉选项 |
| `browser_snapshot` | 捕获无障碍快照 |
| `browser_take_screenshot` | 截取浏览器截图 |
| `browser_type` | 在浏览器元素中输入文本 |
| `browser_wait_for` | 等待文本或时间条件 |
| `browser_tabs` | 管理浏览器标签页 |
| `calculate` | 计算数学表达式 |
| `execute_intent` | 执行 Android Intent |
| `send_broadcast` | 发送 Android 广播 |
| `device_info` | 获取设备信息 |

#### 2.2.2 扩展记忆工具 (Extended Memory Tools) — 9 个

| 工具名 | 说明 |
|--------|------|
| `create_memory` | 创建新记忆 |
| `update_memory` | 更新记忆（按旧标题查找） |
| `delete_memory` | 删除记忆 |
| `move_memory` | 批量移动记忆到目标文件夹 |
| `link_memories` | 创建记忆之间的链接 |
| `query_memory_links` | 查询记忆链接 |
| `update_memory_link` | 更新记忆链接 |
| `delete_memory_link` | 删除记忆链接 |
| `update_user_preferences` | 更新用户偏好（生日/性别/性格/身份/职业/AI风格） |

#### 2.2.3 扩展 HTTP 工具 (Extended HTTP Tools) — 3 个

| 工具名 | 说明 |
|--------|------|
| `http_request` | 发送 HTTP 请求（支持流式输出） |
| `multipart_request` | 多部分表单请求（文件上传） |
| `manage_cookies` | 管理 Cookie (get/set/clear) |

#### 2.2.4 扩展文件工具 (Extended File Tools) — 8 个

| 工具名 | 说明 |
|--------|------|
| `file_exists` | 检查文件是否存在 |
| `move_file` | 移动/重命名文件或目录 |
| `copy_file` | 复制文件或目录（支持跨环境） |
| `file_info` | 获取文件信息 |
| `zip_files` | 压缩文件/目录 |
| `unzip_files` | 解压缩文件 |
| `open_file` | 打开文件（调用系统应用） |
| `share_file` | 分享文件（调用系统分享菜单） |

#### 2.2.5 Tasker 工具 (Tasker Tools) — 1 个

| 工具名 | 说明 |
|--------|------|
| `trigger_tasker_event` | 触发 Tasker 事件 |

#### 2.2.6 工作流工具 (Workflow Tools) — 9 个

| 工具名 | 说明 |
|--------|------|
| `get_all_workflows` | 获取所有工作流 |
| `create_workflow` | 创建工作流 |
| `get_workflow` | 获取工作流详情 |
| `update_workflow` | 更新工作流 |
| `patch_workflow` | 差异更新工作流 |
| `enable_workflow` | 启用工作流 |
| `disable_workflow` | 禁用工作流 |
| `delete_workflow` | 删除工作流 |
| `trigger_workflow` | 触发工作流执行 |

#### 2.2.7 对话工具 (Chat Tools) — 12 个

| 工具名 | 说明 |
|--------|------|
| `start_chat_service` | 启动聊天服务 |
| `stop_chat_service` | 停止聊天服务 |
| `create_new_chat` | 新建对话 |
| `list_chats` | 列出所有对话 |
| `find_chat` | 查找对话 |
| `agent_status` | 查询对话输入状态 |
| `switch_chat` | 切换对话 |
| `update_chat_title` | 更新对话标题 |
| `delete_chat` | 删除对话 |
| `send_message_to_ai` | 发送消息给 AI |
| `list_character_cards` | 列出所有角色卡 |
| `get_chat_messages` | 获取对话消息记录 |

#### 2.2.8 内部文件工具 (Internal File Tools) — 4 个

| 工具名 | 说明 |
|--------|------|
| `read_file_full` | 读取完整文件内容 |
| `read_file_binary` | 读取二进制文件（Base64 编码） |
| `write_file` | 写入文件（支持追加/覆写） |
| `write_file_binary` | 写入二进制文件 |

#### 2.2.9 内部 UI 工具 (Internal UI Tools) — 9 个

| 工具名 | 说明 |
|--------|------|
| `get_page_info` | 获取当前页面/窗口信息 |
| `tap` | 点击屏幕坐标 |
| `long_press` | 长按屏幕坐标 |
| `swipe` | 执行滑动手势 |
| `click_element` | 点击 UI 元素（按 resourceId/className/bounds） |
| `set_input_text` | 在输入框中设置文本 |
| `press_key` | 按下特定按键 |
| `capture_screenshot` | 捕获屏幕截图 |
| `run_ui_subagent` | 运行 UI 自动化子代理 (PhoneAgent) |

#### 2.2.10 软件设置工具 (Software Settings Tools) — 17 个

| 工具名 | 说明 |
|--------|------|
| `read_environment_variable` | 读取环境变量 |
| `write_environment_variable` | 写入/清除环境变量 |
| `list_sandbox_packages` | 列出沙盒包及启用状态 |
| `set_sandbox_package_enabled` | 设置沙盒包启用状态 |
| `execute_sandbox_script_direct` | 直接执行沙盒脚本 |
| `restart_mcp_with_logs` | 重启 MCP 并返回各插件日志 |
| `get_speech_services_config` | 获取 TTS/STT 语音服务配置 |
| `set_speech_services_config` | 更新 TTS/STT 语音服务配置 |
| `test_tts_playback` | 测试 TTS 语音合成 |
| `list_model_configs` | 列出所有模型配置及功能映射 |
| `create_model_config` | 创建模型配置 |
| `update_model_config` | 更新模型配置 |
| `delete_model_config` | 删除模型配置 |
| `list_function_model_configs` | 列出功能-模型绑定 |
| `get_function_model_config` | 获取指定功能的模型配置 |
| `set_function_model_config` | 设置指定功能的模型配置 |
| `test_model_config_connection` | 测试模型配置连接 |

#### 2.2.11 内部系统工具 (Internal System Tools) — 32 个

| 工具名 | 说明 |
|--------|------|
| `close_all_virtual_displays` | 关闭所有虚拟显示器 |
| `modify_system_setting` | 修改系统设置 |
| `get_system_setting` | 获取系统设置 |
| `install_app` | 安装应用 |
| `uninstall_app` | 卸载应用 |
| `list_installed_apps` | 获取已安装应用列表 |
| `start_app` | 启动应用 |
| `stop_app` | 停止应用 |
| `get_notifications` | 获取设备通知 |
| `get_app_usage_time` | 获取应用使用时长 |
| `toast` | 显示 Toast 提示 |
| `send_notification` | 发送通知 |
| `get_device_location` | 获取设备位置 |
| `request_bluetooth_permission` | 请求蓝牙权限 |
| `get_bluetooth_state` | 获取蓝牙适配器状态 |
| `request_enable_bluetooth` | 打开系统对话框启用蓝牙 |
| `list_bluetooth_bonded_devices` | 列出已配对蓝牙设备 |
| `scan_bluetooth_devices` | 扫描附近蓝牙/BLE 设备 |
| `bluetooth_connect` | 连接蓝牙经典设备 |
| `bluetooth_listen` | 监听蓝牙经典连接 |
| `bluetooth_accept` | 接受蓝牙经典连接 |
| `bluetooth_send` | 发送蓝牙数据 |
| `bluetooth_read` | 读取蓝牙数据 |
| `bluetooth_send_and_read` | 发送并读取蓝牙数据 |
| `bluetooth_close` | 关闭蓝牙会话 |
| `bluetooth_ble_connect` | 连接 BLE 设备 |
| `bluetooth_ble_discover_services` | 发现 BLE 服务 |
| `bluetooth_ble_read_characteristic` | 读取 BLE 特征 |
| `bluetooth_ble_write_characteristic` | 写入 BLE 特征 |
| `bluetooth_ble_write_and_read_characteristic` | 写入并读取 BLE 特征 |
| `bluetooth_ble_subscribe_characteristic` | 订阅 BLE 特征通知 |
| `bluetooth_ble_read_notifications` | 读取 BLE 通知 |

#### 2.2.12 FFmpeg 工具 (FFmpeg Tools) — 3 个

| 工具名 | 说明 |
|--------|------|
| `ffmpeg_execute` | 执行通用 FFmpeg 命令 |
| `ffmpeg_info` | 获取 FFmpeg 版本/编解码器信息 |
| `ffmpeg_convert` | 简化视频转换接口 |

---

### 2.3 隐藏工具（不在 Prompt 中但已注册）

这些工具在 `ToolRegistration.kt` 中注册，但**不出现在任何 Prompt 类别**中。AI 无法通过工具描述得知它们的存在，只能通过隐式调用或 CLI 代理模式使用。

| 工具名 | 注册位置 | 说明 |
|--------|---------|------|
| `execute_shell` | ToolRegistration.kt:269 | 代码注释标注"不在提示词加入的工具" |
| `close_all_virtual_displays` | ToolRegistration.kt:281 | 内部虚拟显示器清理，通过系统操作触发 |
| `execute_in_terminal_session_streaming` | ToolRegistration.kt:330 | `execute_in_terminal_session` 的流式输出版本 |
| `send_message_to_ai_streaming` | ToolRegistration.kt:1604 | `send_message_to_ai` 的流式输出版本 |
| `package_proxy` | ToolRegistration.kt:1037 | 内部代理，转发 `packageName:toolName` 格式调用 |

### 2.4 CLI 模式专有工具

仅在 `ToolExposureMode.CLI` 下可用，普通聊天模式中调用会返回错误。

| 工具名 | 说明 |
|--------|------|
| `_search_tools` | 搜索隐藏工具目录，按关键词查找可用工具 |
| `_proxy_tool` | 代理调用隐藏工具，格式: `{tool_name, params}` |

---

## 3. 动态工具包

**注册方式**: 通过 `PackageManager.usePackage()` 动态注册到 `AIToolHandler`
**实现语言**: JavaScript（QuickJS 引擎执行）
**命名格式**: `packageName:toolName`（如 `time:get_current_time`）
**自动激活**: 当 AI 直接以 `packageName:toolName` 格式调用工具时，`AIToolHandler.getToolExecutorOrActivate()` 会自动调用 `usePackage()` 激活对应包

### 包的生命周期

```
发现 (Available) → 启用 (Enabled) → 激活/使用 (Used/Activated)
     │                    │                    │
     │                    │                    └── usePackage() 调用后
     │                    │                        工具注册到 AIToolHandler
     │                    │                        Prompt 中注入工具描述
     │                    │
     │                    └── Enabled 列表 (SharedPreferences)
     │                        initializeDefaultPackages() 自动添加
     │                        工具尚未注册！
     │
     └── 扫描 assets/packages/ + 外部存储
        元数据已解析，等待启用
```

### 3.1 默认启用的 JS 包

这些包 `enabledByDefault: true`，在 `PackageManager.initializeDefaultPackages()` 中自动加入启用列表。AI 可直接调用其工具（触发自动激活），无需先执行 `use_package`。

| 包名 | 文件名 | 类别 | 说明 |
|------|--------|------|------|
| `time` | `time.js` | Utility | 时间日期查询与计算 |
| `system_tools` | `system_tools.js` | System | 系统操作扩展工具 |
| `super_admin` | `super_admin.js` | Admin | 超级管理员工具（需对应权限） |
| `code_runner` | `code_runner.js` | Development | 代码执行与沙盒运行 |
| `ffmpeg` | `ffmpeg.js` | Media | FFmpeg 媒体处理扩展 |
| `file_converter` | `file_converter.js` | Utility | 文件格式转换 |
| `extended_http_tools` | `extended_http_tools.js` | HTTP | HTTP 请求扩展 |
| `extended_file_tools` | `extended_file_tools.js` | File | 文件操作扩展 |
| `extended_memory_tools` | `extended_memory_tools.js` | Memory | 记忆管理扩展 |
| `extended_chat` | `extended_chat.js` | Chat | 对话管理扩展 |
| `workflow` | `workflow.js` | Workflow | 工作流管理扩展 |
| `browser` | `browser.js` | Browser | 浏览器自动化扩展 |
| `operit_editor` | `operit_editor.js` | Editor | 代码/文本编辑器 |
| `daily_life` | `daily_life.js` | Lifestyle | 日常生活工具 |
| `crossref` | `crossref.js` | Academic | 学术参考文献查询 |
| `12306` | `12306.js` | Travel | 火车票查询 |
| `automatic_ui_base` | `automatic_ui_base.js` | UI | UI 自动化基础能力 |
| `various_search` | `various_search.js` | Search | 多引擎搜索聚合 |

### 3.2 需手动激活的 JS 包

这些包 `enabledByDefault: false`（或未设置），需要 AI 显式调用 `use_package` 或用户手动启用后才能使用。

| 包名 | 文件名 | 类别 | 说明 |
|------|--------|------|------|
| `google_search` | `google_search.js` | Search | Google 搜索 |
| `duckduckgo` | `duckduckgo.js` | Search | DuckDuckGo 搜索 |
| `tavily` | `tavily.js` | Search | Tavily AI 搜索 API |
| `zhipu_search` | `zhipu_search.js` | Search | 智谱 AI 搜索 |
| `github` | `github.js` | Development | GitHub API 集成 |
| `automatic_ui_subagent` | `automatic_ui_subagent.js` | UI | UI 自动化子代理 |
| `nanobanana_draw` | `nanobanana_draw.js` | Image Gen | NanoBanana AI 绘图 |
| `minimax_draw` | `minimax_draw.js` | Image Gen | MiniMax AI 绘图 |
| `qwen_draw` | `qwen_draw.js` | Image Gen | 通义千问 AI 绘图 |
| `siliconflow_draw` | `siliconflow_draw.js` | Image Gen | SiliconFlow AI 绘图 |
| `xai_draw` | `xai_draw.js` | Image Gen | xAI Grok 绘图 |
| `openai_draw` | `openai_draw.js` | Image Gen | OpenAI DALL-E 绘图 |
| `zhipu_draw` | `zhipu_draw.js` | Image Gen | 智谱 AI 绘图 |

### 3.3 ToolPkg 归档包

这些是 ZIP 格式的多文件包（`.toolpkg`），包含 `manifest.json` + JS 入口 + 子包 + 资源文件。由 `ToolPkgLoader` 加载到 `ToolPkgManager` 管理。

| 包 ID | 文件夹 | 类型 | 说明 | 默认启用 |
|-------|--------|------|------|:---:|
| `com.operit.windows_bundle` | `windows_control/` | Remote | Windows 远程控制套件 | ✅ |
| *(varies)* | `linux_ssh/` | Remote | Linux SSH 远程管理 | ❌ |
| *(varies)* | `deepsearching/` | Agent | 深度搜索（子代理编排） | ❌ |
| *(varies)* | `message_insert/` | Chat | 消息插入与管理 | ❌ |
| *(varies)* | `apktool/` | Dev | APK 逆向工程工具 | ❌ |
| *(varies)* | `remote_operit/` | Remote | 远程 Operit 实例控制 | ❌ |
| *(varies)* | `worldbook/` | RP | 世界书（角色扮演世界观） | ❌ |
| *(varies)* | `qqbot/` | Social | QQ 机器人集成 | ❌ |
| *(varies)* | `thinking_guidance/` | Prompt | 思考链指导（CoT 增强） | ❌ |
| *(varies)* | `plan_mode/` | Prompt | 计划模式（分步执行） | ❌ |
| *(varies)* | `context_limiter_c/` | System | 上下文长度限制器 | ❌ |

此外，`examples/` 中还有以下未列入白名单的 ToolPkg 包（未打包进 APK）：

| 文件夹 | 说明 |
|--------|------|
| `custom_ai_provider/` | 自定义 AI 服务商配置 |
| `debug_msg_dump/` | 调试消息导出 |
| `desktop_widget_demo/` | 桌面小部件演示 |
| `dino_runner/` | 恐龙跑酷小游戏 |
| `github/` (文件夹版) | GitHub 操作工具（多文件版） |
| `sidebar_account_book/` | 侧边栏记账本 |
| `sidebar_bing_action/` | 侧边栏必应操作 |
| `sidebar_model_sites/` | 侧边栏模型站点 |
| `sidebar_opencode/` | 侧边栏 OpenCode |
| `sidebar_sillytavern/` | 侧边栏 SillyTavern |
| `subagent/` | 子代理模板 |
| `template_try/` | 模板试用 |

---

## 4. 其他动态工具来源

### 4.1 MCP 工具

| 属性 | 说明 |
|------|------|
| **实现** | `MCPManager` + `MCPBridgeClient` 连接远端 MCP Server |
| **注册方式** | 用户配置 MCP Server URL → 连接成功 → 调用 `getTools()` 获取工具列表 → `MCPToolExecutor` 注册 |
| **命名格式** | `serverName:toolName` |
| **自动激活** | `getToolExecutorOrActivate()` 检测到 `:` 分隔符且包名匹配已注册 MCP Server 时自动重连 |
| **生命周期** | 会话级别，连接断开后支持自动重连 |
| **Prompt 可见** | 激活后，Server 提供的工具 Schema 自动注入 Prompt |

### 4.2 Skill 技能

| 属性 | 说明 |
|------|------|
| **实现** | `SkillManager` 扫描 `Downloads/Operit/skills/` 目录中的 `SKILL.md` |
| **注册方式** | **不注册为 ToolExecutor** — 仅将 `SKILL.md` 内容作为系统指令注入 Prompt |
| **激活方式** | `use_package <skillName>` → 返回 SKILL.md 全文作为系统消息 |
| **导入** | 支持从 ZIP 文件导入技能包 |
| **生命周期** | 每次访问时重新读取文件系统中的 SKILL.md |

### 4.3 PhoneAgent

| 属性 | 说明 |
|------|------|
| **入口工具** | 内置默认工具 `run_ui_subagent` |
| **工作模式** | 截图 → 视觉模型决策 → 执行动作 (tap/swipe/type 等) → 循环 |
| **底层实现** | Shower 系统（ADB/root 虚拟屏幕）或标准 UI 工具 |
| **支持并发** | 多个 agentId 可同时运行，每个可操作不同虚拟屏幕 |

---

## 5. 注册与激活流程

### 5.1 内置默认工具注册流程

```
App 启动
  └── AIToolHandler.getToolExecutorOrActivate() 首次调用
        └── registerDefaultTools()
              └── ToolRegistration.registerAllTasks(handler, context)
                    ├── 注册 Shell 工具 (1)
                    ├── 注册终端工具 (6)
                    ├── 注册音乐工具 (8)
                    ├── 注册浏览器工具 (22)
                    ├── 注册记忆工具 (9)
                    ├── 注册文件系统工具 (18)
                    ├── 注册 UI 工具 (9)
                    ├── 注册系统操作工具 (32)
                    ├── 注册 HTTP 工具 (3)
                    ├── 注册 FFmpeg 工具 (3)
                    ├── 注册工作流工具 (9)
                    ├── 注册对话工具 (12)
                    ├── 注册软件设置工具 (17)
                    ├── 注册其他工具 (calculate, visit_web, sleep, use_package, ...)
                    └── 注册 CLI 工具 (_search_tools, _proxy_tool, package_proxy)
```

### 5.2 动态工具包激活流程

```
方式 1: AI 显式调用 use_package
  AI → use_package("time")
    → PackageManager.usePackage("time")
      → 验证环境变量
      → registerPackageTools() 注册 time:get_current_time, time:xxx 等
      → 返回工具列表描述文本给 AI

方式 2: AI 直接调用（自动激活）
  AI → time:get_current_time
    → AIToolHandler.getToolExecutorOrActivate("time:get_current_time")
      → availableTools["time:get_current_time"] == null
      → toolName 包含 ':'
      → PackageManager.usePackage("time")  ← 自动激活
      → availableTools["time:get_current_time"] 现在可用
    → 执行工具

方式 3: 用户手动启用
  Settings UI → 启用包 → enablePackage() → 写入偏好设置
  后续 AI 调用时触发自动激活（方式 2）
```

### 5.3 MCP 工具激活流程

```
用户添加 MCP Server (name + URL)
  → MCPManager.registerServer(name, url, description)
    → AI 调用 use_package(name) 或直接调用 name:toolName
      → MCPPackage.loadFromServer()
        → MCPBridgeClient 连接远端
        → getTools() 获取工具列表
        → 转换为 ToolPackage
        → 注册 name:tool1, name:tool2, ...
      → 工具可用

断线重连:
  getToolExecutorOrActivate() 检测到 executor 存在但 MCP 连接断开
  → 自动重连 → usePackage() → 重新注册
```

### 5.4 权限分级机制

所有内置工具通过 `ToolGetter` 按权限等级分发：

```
androidPermissionPreferences.getPreferredPermissionLevel()
  ├── STANDARD     → Standard* 实现（基础能力）
  ├── ACCESSIBILITY → Accessibility* 实现（无障碍服务增强）
  ├── DEBUGGER     → Debugger* 实现（ADB 调试增强）
  ├── ADMIN        → Admin* 实现（设备管理员增强）
  └── ROOT         → Root* 实现（完整 root 权限）
```

受权限影响的工具类别：文件系统、UI 操作、系统操作、设备信息。其余类别（终端、音乐、HTTP、记忆、计算器等）仅提供标准实现。

---

## 附录：工具数量汇总

| 类别 | 数量 |
|------|------|
| **内置 AI 可见工具** | 16 |
| **内置内部工具** | ~90 |
| **内置隐藏工具** | 7 |
| **内置工具总计** | 113 |
| **动态 JS 包 (默认启用)** | 18 |
| **动态 JS 包 (需手动激活)** | 13 |
| **动态 ToolPkg 包 (白名单)** | 11 |
| **动态 ToolPkg 包 (未打包)** | 13 |
| **MCP 工具** | 动态（取决于远端 Server） |
| **Skill 技能** | 动态（取决于用户安装） |
