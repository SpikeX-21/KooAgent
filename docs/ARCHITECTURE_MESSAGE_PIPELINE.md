# Operit 源码学习地图：消息管线与工具系统

本文档是 Operit 核心流程的**源码级学习指南**，覆盖从"用户点击发送按钮"到"AI 回复渲染到屏幕"再到"工具调用结果回传 LLM"的完整链路。适合初次接触该项目的开发者，建议按推荐阅读顺序逐层深入。

---

## 〇、先导信息

### 核心数据模型速览

| 类型 | 文件 | 用途 |
|------|------|------|
| `ChatMessage` | `data/model/ChatMessage.kt` | UI 层消息模型，含 sender、content、contentStream、token 指标 |
| `PromptTurn` | `core/chat/hooks/PromptTurn.kt` | AI 服务层消息模型，含 kind (USER/ASSISTANT/TOOL_RESULT/SUMMARY) |
| `AITool` | `data/model/AITool.kt` | 工具定义，含 name + List\<ToolParameter\> |
| `ToolInvocation` | `data/model/ToolInvocation.kt` | 一次工具调用，含 tool + rawText + responseLocation |
| `ToolResult` | `data/model/ToolResult.kt` | 工具执行结果，含 toolName + success + result + error |
| `ToolExecutor` | `core/tools/AIToolHandler.kt:480` | 工具执行器接口，invoke() / invokeAndStream() / validateParameters() |

### 关键概念

- **Agent Loop**：用户消息 → LLM → 工具调用 → 工具结果回传 → LLM → ... → 最终回复的循环
- **SharedStream**：支持多订阅者并发消费的热流，`shareRevisable()` 创建，支持 SAVEPOINT/ROLLBACK
- **PromptHook**：两阶段可插拔管线（`before_finalize_prompt` → `before_send_to_model`），允许外部插件修改 prompt
- **FunctionType**：不同功能（CHAT / SUMMARY / MEMORY / IMAGE_RECOGNITION 等）使用不同的模型实例

---

## 推荐阅读顺序

```
Step 1  读懂宏观架构      → 第一、二章：架构总览 + 职责边界表
Step 2  跟踪一次发送      → 第八章：完整数据流（端到端 60 步调用链）
Step 3  深入消息管线各层   → 第三～六章：四个核心类逐一深读
Step 4  理解工具系统       → 第九、十章：注册→查找→执行 + 数据转换管线
Step 5  了解 PhoneAgent   → 第十一章：另一个 Agent Loop
Step 6  查漏补缺          → 第十二章：关键文件索引 + 修改 Checklist
```

---

## 一、架构总览

```
用户操作 (点击发送 / Token超限 / 手动总结 / 重新生成)
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MessageCoordinationDelegate                           ← 决策层      │
│ services/core/MessageCoordinationDelegate.kt  (1967 行)             │
│ "什么时候发、以什么条件发"                                           │
│                                                                     │
│ • 群组编排 → 解析角色卡群组，按 Planner 模型输出的轮次逐个发送         │
│ • 总结触发 → 判断 Token/消息数是否超阈值，触发同步或异步总结          │
│ • 自动续写 → Token超限后总结完成→排队自动发送续写                     │
│ • 上下文窗口 → 每轮结束后刷新窗口估计值并持久化                       │
│ • 重新生成 → 取历史中某条 AI 消息，重新请求模型                      │
└──────────────┬──────────────────────────────────────────────────────┘
               │ 调用 sendUserMessage(attachments, chatId, workspacePath, ...)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MessageProcessingDelegate                               ← 执行层    │
│ services/core/MessageProcessingDelegate.kt  (1769 行)               │
│ "怎么发、怎么渲染流、怎么处理后处理"                                   │
│                                                                     │
│ • 防重入检查 (同 chatId 正在发送则拒绝)                               │
│ • 挂载 Workspace 备份 Hook                                           │
│ • 流式消费 → 多订阅者并行消费 (热流 SharedStream)                     │
│   ├─ 主收集: 逐 chunk 更新 ChatMessage + 定时持久化 (1s间隔)          │
│   ├─ Waifu: 分段 + 打字机延迟 + 逐句 TTS                             │
│   ├─ 自动朗读: TtsSegmenter 分段 + TTS 朗读                         │
│   └─ Revision: SAVEPOINT/ROLLBACK 流式回滚追踪                      │
│ • 取消处理 (保留/不保留已输出内容)                                    │
│ • Token 指标回写 + 首字节耗时统计                                     │
└──────────────┬──────────────────────────────────────────────────────┘
               │ 调用 AIMessageManager.buildUserMessageContent()
               │ 调用 AIMessageManager.sendMessage()
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AIMessageManager                                         ← 枢纽层    │
│ core/chat/AIMessageManager.kt  (1412 行)                             │
│ "怎么拼装消息、怎么跟 EnhancedAIService 交互"                         │
│                                                                     │
│ • buildUserMessageContent() → 原始输入→XML 标签拼装                  │
│ • sendMessage() → ChatMessage→PromptTurn → 多媒体裁剪 → 插件拦截     │
│   → enhancedAiService.sendMessage() → SharedStream<String>           │
│ • summarizeMemory() → 压缩对话历史 → 调用总结模型                    │
│ • calculateStableContextWindow() → 预估 Token 占用                   │
│ object 单例，无状态                                                   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ enhancedAiService.sendMessage(SendMessageOptions)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ EnhancedAIService                                       ← 引擎层    │
│ api/chat/EnhancedAIService.kt  (3152 行)                             │
│ "Agent Loop: 用户消息 → LLM → 工具调用 → LLM → ... → 最终回复"       │
│                                                                     │
│ • sendMessage() → 准备对话历史 → PromptHook → 工具列表 → LLM 请求    │
│ • Agent Loop (递归调用链):                                           │
│   processStreamCompletion → 检测工具 → handleToolInvocation          │
│   → ToolExecutionManager.executeInvocations → processToolResults     │
│   → 结果加入历史 → sendMessage → processStreamCompletion (递归)      │
│ • 服务生命周期: startAiService / stopAiService / cancelConversation  │
└──────────────┬──────────────────────────────────────────────────────┘
               │ serviceForFunction.sendMessage(chatHistory, tools)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AIService (接口) + LLM Provider 实现                   ← 传输层     │
│ api/chat/llmprovider/                                               │
│                                                                     │
│ 将 PromptTurn 列表转为 OpenAI / Claude / Gemini 等 API 的请求格式     │
│ 返回 Stream<String> → 流式 token 输出                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、各层职责边界

| 层 | 类 | 核心问题 | 输入 → 输出 |
|----|-----|---------|------------|
| 决策层 | `MessageCoordinationDelegate` | 发不发、怎么发 | 用户操作 → 调用下层 delegate |
| 执行层 | `MessageProcessingDelegate` | 发了之后怎么处理流 | chatId + 配置 → UI 更新完成 |
| 枢纽层 | `AIMessageManager` | 消息怎么拼、历史怎么传 | ChatMessage 列表 → SharedStream\<String\> |
| 引擎层 | `EnhancedAIService` | LLM + Agent Loop | SendMessageOptions → 完整 AI 回复 |
| 传输层 | `AIService` | API 协议翻译 | PromptTurn 列表 → Stream\<String\> |

**贯穿各层的设计模式**：
- **委托模式**：每一层通过构造函数注入依赖，不直接持有下层引用
- **流式处理**：全链路使用 Stream/SharedStream 传递数据，支持背压和取消
- **Hook 管线**：关键节点（PromptHook、AIToolHook）支持外部插件介入

---

## 三、MessageCoordinationDelegate — 决策层

**文件**：`services/core/MessageCoordinationDelegate.kt` (1967 行)

消息管线的"大脑"。不执行消息发送细节，只决定**在什么条件下以何种方式发送**。

### 3.1 核心决策流程 (sendMessageInternal, 行 472-700)

```
sendMessageInternal()
  │
  ├─ ① 群组编排检查 (行 506-551)
  │     shouldRunGroupOrchestration() → 角色群组卡?
  │       → orchestrateGroupConversation() → 按轮次逐个成员发送 → 返回
  │       否则 → 递归调用 sendMessageInternal(enableGroupOrchestration=false)
  │
  ├─ ② 角色卡绑定解析 (行 564-607)
  │     resolveRoleCardChatModelOverrides()        → 固定模型配置?
  │     resolveRoleCardMemoryProfileOverride()     → 固定记忆配置?
  │     resolveChatContextSettingsForRequest()     → 上下文长度/总结阈值
  │
  ├─ ③ 总结检查 — 不阻塞发送 (行 620-655)
  │     AIMessageManager.shouldGenerateSummary() → 需要总结?
  │       ├─ 是 → launchAsyncSummaryForSend()   异步总结，与发送并行
  │       │        tokenUsageThreshold += 0.5    提高阈值防止重复触发
  │       └─ 否 → 继续
  │
  ├─ ④ 委托发送 (行 667-690)
  │     messageProcessingDelegate.sendUserMessage(
  │         attachments, chatId, workspacePath,
  │         maxTokens, tokenUsageThreshold, ...
  │     )
  │
  └─ ⑤ 清理附件 + 回复引用 (行 693-699)
```

### 3.2 群组编排 (orchestrateGroupConversation, 行 723-951)

当活动 prompt 是角色群组卡时接管消息处理：

1. `planResponseOrder()` (行 962-1009) → 调用 `FunctionType.ROLE_RESPONSE_PLANNER` 模型
2. 模型返回 `{"rounds": [[{"id":"card1"},{"id":"card2"}],[{"id":"card3"}]]}`
3. `parsePlannedRounds()` (行 1011-1104) 支持新旧两种 JSON 格式
4. 按轮次逐个成员发送，`awaitTurnComplete()` (行 1174-1193) 等待每位回复（最多 180s）
5. 后续成员可见前序发言摘要（行 934-935, ≤220 字符压缩）

### 3.3 两种总结模式

| | 同步总结 `summarizeHistory` | 异步总结 `launchAsyncSummaryForSend` |
|---|---|---|
| 行号 | 1777-1940 | 1676-1771 |
| 触发场景 | 手动触发 / Token 超限 | 发送前检测需要总结 |
| 阻塞发送? | **是**（总结完才发） | **否**（与发送并行） |
| 完成后行为 | autoContinue=true → 自动续写 | 插入历史 → 刷新上下文窗口 |

### 3.4 自动续写 (queuePendingAutoContinuation, 行 1226-1306)

Token 超限→总结完成→自动继续对话的机制：

```
queuePendingAutoContinuation()
  └─ waitJob = launch {
       while (chat 仍在加载) { awaitTurnComplete() }  // 等当前回合结束
       sendMessageInternal(isContinuation=true, isAutoContinuation=true)
     }
```

### 3.5 上下文窗口刷新 (refreshStableContextWindow, 行 225-282)

每轮完成后调用，重新计算 Token 占用估计值并持久化。

---

## 四、MessageProcessingDelegate — 执行层

**文件**：`services/core/MessageProcessingDelegate.kt` (1769 行)

消息发送的完整生命周期管理器。负责将用户操作转换为流式 AI 响应并实时渲染。

### 4.1 ChatRuntime — 每对话运行时状态 (行 128-138)

```kotlin
private data class ChatRuntime(
    var sendJob: Job?,                       // 主协程 (sendUserMessage 所在)
    var responseStream: SharedStream<String>?, // AI 响应流 (供悬浮窗等外部读取)
    var streamCollectionJob: Job?,           // 流收集协程
    var stateCollectionJob: Job?,            // AI 状态监听协程
    var firstResponseElapsed: Long?,         // 首字节到达时刻
    val isLoading: MutableStateFlow<Boolean>
)
```

保存在 `ConcurrentHashMap<String, ChatRuntime>` (行 140)。

### 4.2 sendUserMessage() 核心流程 (行 552-1403, 约 850 行)

```
sendUserMessage()
  │
  ├─ 阶段 A: 防重入 + 预处理 (行 576-605)
  │     空消息拦截 → 防重入检查 → 清除草稿 → 设置 loading 状态
  │
  ├─ 阶段 B: 模型配置 + 用户消息构建 (行 627-661)
  │     modelConfigManager.getModelConfigFlow() → 决定识图/识音频/识视频能力
  │     AIMessageManager.buildUserMessageContent() → 拼装 XML
  │
  ├─ 阶段 C: 添加用户消息 + 挂载 Workspace Hook (行 663-729)
  │     shouldAddUserMessageToChat 判断 → addMessageToChat()
  │     workspacePath 不为空 → WorkspaceBackupManager.createToolHookSession()
  │
  ├─ 阶段 D: 获取 AI 服务 + 状态监听 (行 757-799)
  │     EnhancedAIService.getChatInstance() 优先复用
  │     stateCollectionJob: 监听 inputProcessingState → 映射到 UI
  │
  ├─ 阶段 E: 发送消息 (行 896-932)
  │     AIMessageManager.sendMessage() → SharedStream<String>
  │
  ├─ 阶段 F: 流式消费 — 四种模式并行 (行 1054-1232)
  │     ┌─ 主收集 (行 1177-1202): 逐 chunk 更新 + 1s间隔持久化
  │     ├─ Waifu (行 1133-1146): 逐句分段 + 打字机延迟
  │     ├─ 自动朗读 (行 1124-1132): TtsSegmenter 分段 TTS
  │     └─ Revision (行 1148-1175): SAVEPOINT/ROLLBACK 追踪
  │
  └─ 阶段 G: 收尾 (行 1239-1398)
        Token 统计 → 耗时计算 → finalizeMessageAndNotify() → cleanupRuntimeAfterSend()
```

### 4.3 取消操作 (行 395-448)

```kotlin
// 用户手动停止 → 保留已输出内容
cancelMessage(chatId)

// 破坏性操作前 → 不保留已输出内容
cancelMessageForDestructiveMutation(chatId)

// cancelMessageInternal 执行顺序:
// 1. 读取 Token 快照 (行 398-399)
// 2. 收集所有活跃 Job (行 400-405)
// 3. AIMessageManager.cancelOperation(chatId) (行 408)
// 4. cancel + join 所有 Job (行 410-416)
// 5. [keepPartialResponse] detachStreamingAiMessage() (行 422-424)
// 6. 清理 ChatRuntime (行 426-438)
```

### 4.4 暴露给 UI 的状态流

| Flow | 用途 |
|------|------|
| `userMessage: StateFlow<TextFieldValue>` | 输入框内容 |
| `isLoading: StateFlow<Boolean>` | 任意对话是否加载中 |
| `activeStreamingChatIds: StateFlow<Set<String>>` | 正在流式输出的对话 ID |
| `inputProcessingStateByChatId: StateFlow<Map<String, EnhancedInputProcessingState>>` | 每个对话的 AI 状态 (Idle→Processing→Connecting→Receiving→ExecutingTool→Completed) |
| `scrollToBottomEvent: SharedFlow<Unit>` | 触发列表自动滚动 (200ms 节流) |
| `nonFatalErrorEvent: SharedFlow<String>` | 非致命错误提示 |
| `turnCompleteCounterByChatId: StateFlow<Map<String, Long>>` | 回合完成计数 |
| `currentTurnToolInvocationCountByChatId: StateFlow<Map<String, Int>>` | 当前回合工具调用次数 |

---

## 五、AIMessageManager — 枢纽层

**文件**：`core/chat/AIMessageManager.kt` (1412 行)

`object` 单例，无状态。负责消息拼装、格式转换、总结生成、取消管理。

### 5.1 sendMessage() 流程 (行 320-504)

```
1. getMemoryFromMessages(chatHistory)         ← ChatMessage → PromptTurn
2. limitImageLinksInChatHistory()             ← 裁剪图片链接 (只留最近 N 轮)
3. limitMediaLinksInChatHistory()             ← 裁剪音视频链接
4. MessageProcessingPluginRegistry 检查        ← 插件匹配?
   ├─ 匹配 → 插件接管，返回 pluginStream
   └─ 未匹配 → 走普通通道
5. enhancedAiService.sendMessage(SendMessageOptions)
```

### 5.2 buildUserMessageContent() — 消息拼装 (行 117-298)

将原始输入包装为结构化 XML：

```kotlin
listOf(proxySenderTag, processedMessageText, attachmentTags, workspaceTag, replyTag)
    .filter { it.isNotBlank() }
    .joinToString(" ")
```

Attachment 四种处理路径：

| 条件 | 处理 |
|------|------|
| 图片 + 模型支持直接识图 | `MediaLinkBuilder.image()` → `[IMG:xxx]` + `ImagePoolManager` |
| 音频 + 模型支持直接识音频 | `MediaLinkBuilder.audio()` → `[AUDIO:xxx]` + `MediaPoolManager` |
| 视频 + 模型支持直接识视频 | `MediaLinkBuilder.video()` → `[VIDEO:xxx]` |
| 其他 | `<attachment id=... type=...>content</attachment>` |

每种都有 try-catch 降级到普通格式。

### 5.3 summarizeMemory() — 对话总结 (行 654-1064)

核心挑战：压缩海量对话历史让总结 LLM 仍能理解。压缩策略：

| 函数 | 目标 | 策略 |
|------|------|------|
| `condenseHeadTail` | 任意文本 | 保留头部+尾部，中间 `...` |
| `pruneUserMessageForReview` | 用户消息 | 移除 workspace/attachment/reply 大块 + 压缩 tool_result |
| `condenseToolParams` | 工具参数 | 最多保留 8 个参数 |
| `condenseAssistantForReview` | AI 回复 | 拆 text/tool/tool_result 段落→分别压缩→合并 |
| 段落数限制 | 防过长 | 超 25 段只留开头 12 + 结尾 10 |

### 5.4 取消操作 (行 610-644)

并发取消三个层级：

```kotlin
// 1. 取消插件执行
activeMessageProcessingControllerByChatId[chatKey]?.cancel()

// 2. 取消 AI 服务 (终止流 + 工具执行)
activeEnhancedAiServiceByChatId[chatKey]?.cancelConversation()

// 3. 取消 ToolPkg JS 脚本
packageManager.cancelToolPkgExecutionsForChat(chatKey, "User cancelled")
```

---

## 六、EnhancedAIService — 引擎层 (Agent Loop)

**文件**：`api/chat/EnhancedAIService.kt` (3152 行)

Agent 运行时引擎，将 LLM 推理、工具调用、状态管理串联为完整循环。

### 6.1 实例管理 (行 104-144)

```kotlin
@Volatile private var INSTANCE: EnhancedAIService? = null           // 全局单例
private val CHAT_INSTANCES = ConcurrentHashMap<String, EnhancedAIService>() // 每 chatId 独立
```

### 6.2 并发隔离 — MessageExecutionContext (行 426-435)

```kotlin
private data class MessageExecutionContext(
    val executionId: Int,                              // 每次 sendMessage 分配唯一 ID
    val streamBuffer: StringBuilder,                   // 累积 AI 回复文本
    val roundManager: ConversationRoundManager,         // 管理当前轮次内容
    val isConversationActive: AtomicBoolean,            // 取消时设为 false
    val conversationHistory: MutableList<PromptTurn>,   // 本轮对话历史 (共享引用!)
    val eventChannel: MutableSharedStream<TextStreamEvent>, // SAVEPOINT/ROLLBACK 事件
    var modelExecutionSnapshot: ModelExecutionSnapshot?  // 模型实例租约
)
```

### 6.3 sendMessage() 九步流程 (行 856-1276)

| 步骤 | 行号 | 做什么 |
|------|------|--------|
| 1 | 916-924 | 创建 MessageExecutionContext |
| 2 | 930-932 | `startAiService()` — 前台通知"运行中" |
| 3 | 942-948 | `getModelExecutionSnapshot()` — 租用 AIService 实例 |
| 4 | 951-968 | `prepareConversationHistory()` — 拼装系统提示词 + 历史 |
| 5 | 1012-1034 | 两阶段 PromptHook (`before_finalize_prompt` → `before_send_to_model`) |
| 6 | 1000-1008 | `getAvailableToolsForFunction()` — 决定工具列表 |
| 7 | 1073-1088 | `AIService.sendMessage()` → Stream\<String\> |
| 8 | 1104-1176 | 流处理: 逐 chunk + Revision 追踪 |
| 9 | 1235-1259 | `processStreamCompletion()` — Agent Loop 入口 |

### 6.4 Agent Loop 递归调用链 (行 1660 → 2019 → 2138 → 1660)

```
sendMessage()
  └─ processStreamCompletion()                          ← 第一轮 (协程 C1: stream{} 构建器)
       ├─ [无工具] finalizeAssistantResponse()           ← 终止
       └─ [有工具] handleToolInvocation()               (行 1903)
            └─ toolProcessingScope.launch {              ← 创建协程 C2
                 └─ ToolExecutionManager.executeInvocations() (行 2067)
                 └─ processToolResults()                (行 2081)
                      ├─ conversationHistory.add(TOOL_RESULT)  (行 2205) ← 写入历史
                      ├─ AIService.sendMessage()               (行 2294) ← 再请求
                      └─ processStreamCompletion()             (行 2420) ← 递归!
                           └─ [无工具] → 终止
                           └─ [有工具] → launch C3 → ...
              }
            └─ processToolJob.join()                    (行 2130) ← C1 等 C2
```

**为什么是递归而非 while 循环**：每轮在 `toolProcessingScope` 中创建新协程 + `join()` 等待。不是栈递归，但存在工程问题：

1. 每轮创建新协程（资源浪费）
2. 第一轮在 `stream{}` 协程中执行，后续轮在 `toolProcessingScope` 中执行，取消行为不一致
3. 共享 `accumulated*TokenCount` 变量跨协程非原子操作（当前因 `join()` 链恰好安全）
4. 控制流跨三个方法、两个协程作用域，追踪困难

### 6.5 终止条件 (processStreamCompletion, 行 1660-1955)

| 条件 | 行号 | 行为 |
|------|------|------|
| 回复内容为空 | 1697 | `finalizeAssistantResponse()` → 结束 |
| 纯思考输出 (正文为空) | 1719 | 注入警告 → 回传 AI 继续 |
| 工具调用 XML 截断 | 1833 | 自动补齐 → 注入警告 → 回传 AI |
| 含完整工具调用 | 1896 | `handleToolInvocation()` → 递归继续 |
| 普通文本回复 | 1932 | `finalizeAssistantResponse()` → **正常终止** |

### 6.6 工具结果写入下一轮的关键三行 (行 2168 → 2205 → 2294)

```kotlin
// 行 2168: 格式化工具结果为 XML
val rawToolResultMessage = ConversationMarkupManager.buildBoundedToolResultMessage(results)

// 行 2205: 写入共享的 MutableList
context.conversationHistory.add(PromptTurn(kind = TOOL_RESULT, content = toolResultMessage))

// 行 2294: 同一 List 引用传给 LLM
serviceForFunction.sendMessage(chatHistory = currentChatHistory, ...)
```

三个步骤操作同一 `MutableList<PromptTurn>` 实例，`add()` 后下一次 `sendMessage()` 自动包含工具结果。

### 6.7 工具列表构建 (getAvailableToolsForFunction, 行 2813-2952)

决定因素：
- 全局工具开关 → `apiPreferences.enableToolsFlow`
- 角色卡工具白名单 → `CharacterCardToolAccessResolver`
- CLI/标准模式 → `ToolExposureMode`
- 中/英文 → `LocaleUtils`
- 代理工具 → `package_proxy`
- PromptHook 过滤 → `applyToolPromptComposeHooksToAvailableTools()`

---

## 七、数据模型转换

```
ChatMessage (UI)                          PromptTurn (AI 服务)
┌──────────────────────┐                 ┌──────────────────────────┐
│ sender: "user"/"ai"   │  ──────────→  │ kind: USER/ASSISTANT/    │
│ content: "你好"       │  getMemory     │       TOOL_RESULT/SUMMARY│
│ roleName: "角色A"     │  FromMessages  │ content: "你好"          │
│ contentStream: Stream? │               │ toolName: "read_file"    │
│ timestamp: 1234567890 │                 └──────────────────────────┘
│ inputTokens / outputTokens             │
└──────────────────────┘                 │ 这些会被 AIService 转为
                                         │ OpenAI/Claude/Gemini 的
                                         │ messages 格式
```

转换发生位置：`AIMessageManager.getMemoryFromMessages()` (行 1289-1346)。

---

## 八、完整数据流：一次发送的 60 步

以 "帮我读 config.json 并列出所有 key" 为例：

```
MessageCoordinationDelegate.sendUserMessage()              ← ① 入口
  ├─ ② 解析角色卡/模型配置绑定
  ├─ ③ shouldGenerateSummary? → 异步总结 (不阻塞)
  └─ ④ messageProcessingDelegate.sendUserMessage(...)
       │
MessageProcessingDelegate.sendUserMessage()                ← ⑤ 执行层入口
  ├─ ⑥ 防重入检查
  ├─ ⑦ 挂载 WorkspaceBackupManager Hook
  ├─ ⑧ AIMessageManager.buildUserMessageContent()
  │     → "<proxy_sender>...帮我读...<attachment>..."
  ├─ ⑨ addMessageToChat(userMessage)
  ├─ ⑩ AIMessageManager.sendMessage()
  │     │
AIMessageManager.sendMessage()                             ← ⑪ 枢纽层入口
  ├─ ⑫ getMemoryFromMessages() → List<PromptTurn>
  ├─ ⑬ limitImageLinks / limitMediaLinks
  ├─ ⑭ MessageProcessingPlugin → 未匹配
  └─ ⑮ enhancedAiService.sendMessage(SendMessageOptions)
       │
EnhancedAIService.sendMessage()                            ← ⑯ 引擎层入口
  ├─ ⑰ MessageExecutionContext 创建
  ├─ ⑱ startAiService() 前台通知
  ├─ ⑲ getModelExecutionSnapshot() 租用模型
  ├─ ⑳ prepareConversationHistory() 拼装系统提示词
  ├─ ㉑ PromptHook: before_finalize_prompt
  ├─ ㉒ PromptHook: before_send_to_model
  ├─ ㉓ getAvailableToolsForFunction() 工具列表
  ├─ ㉔ AIService.sendMessage() → Stream<String>
  │     │
  │     │  LLM 回复:
  │     │  <tool_call name="read_file"><param name="path">config.json</param></tool_call>
  │     │
  ├─ ㉕ 流收集: responseStream.collect { emit(chunk) }
  ├─ ㉖ processStreamCompletion()
  │     ├─ ㉗ extractToolInvocations() → 1 个 ToolInvocation
  │     ├─ ㉘ handleToolInvocation()
  │     │     └─ ㉙ toolProcessingScope.launch {
  │     │          ├─ ㉚ ToolExecutionManager.executeInvocations()
  │     │          │     ├─ Layer 1: 工具暴露模式检查
  │     │          │     ├─ Layer 2: 角色卡权限检查
  │     │          │     ├─ Layer 3: Hook 拦截 + 权限弹窗
  │     │          │     ├─ ㉛ AIToolHandler.getToolExecutorOrActivate("read_file")
  │     │          │     ├─ ㉜ executor.validateParameters()
  │     │          │     ├─ ㉝ executor.invoke(tool) → 读文件
  │     │          │     └─ ㉞ ConversationMarkupManager.formatToolResultForMessage()
  │     │          │           → <tool_result_xxx name="read_file" status="success">
  │     │          │               <content>...JSON内容...</content>
  │     │          │             </tool_result_xxx>
  │     │          │
  │     │          └─ ㉟ processToolResults()
  │     │               ├─ ㊱ conversationHistory.add(TOOL_RESULT, xml)
  │     │               ├─ ㊲ AIService.sendMessage(chatHistory=含TOOL_RESULT)
  │     │               │     │
  │     │               │     │  LLM 回复: "config.json 包含以下 key: key1, key2, key3"
  │     │               │     │
  │     │               │     └─ ㊳ 流收集
  │     │               │
  │     │               └─ ㊴ processStreamCompletion()
  │     │                     └─ extractToolInvocations().isEmpty()
  │     │                         → ㊵ finalizeAssistantResponse() ← 终止!
  │     │        }
  │     └─ processToolJob.join()
  │
  └─ ㊶ 返回 Stream<String> (聚合所有轮次)

MessageProcessingDelegate 流收集协程                         ← ㊷ 回到执行层
  ├─ ㊸ 主收集: 逐 chunk 更新 aiMessage.content + persistStreamingSnapshot()
  ├─ ㊹ 自动朗读: TTS 分段
  └─ ㊺ Revision 追踪: SAVEPOINT/ROLLBACK

MessageProcessingDelegate 收尾                                ← ㊻ 生命周期结束
  ├─ ㊼ 提取 Token 统计 (input/output/cached)
  ├─ ㊽ 计算 waitDurationMs + outputDurationMs
  ├─ ㊾ finalizeMessageAndNotify()
  │     ├─ resolveFinalContent()  ← SharedStream replay cache → 最终文本
  │     ├─ addMessageToChat(finalMessage)  ← 固化无流的消息到 DB
  │     └─ 自动朗读完整回复
  ├─ ㊿ cleanupRuntimeAfterSend()
  │     ├─ 卸载 workspaceHook
  │     ├─ cleanupRuntime (重置 ChatRuntime)
  │     └─ notifyTurnComplete() → refreshStableContextWindow()
  └─ done
```

---

## 九、工具系统：注册 → 查找 → 执行

### 9.1 架构概览

三个文件协作完成工具生命周期：

| 阶段 | 文件 | 行号 | 数据结构 | 复杂度 |
|------|------|------|---------|--------|
| 注册 | `ToolRegistration.kt` (2620行) | `registerAllTools()` | `ConcurrentHashMap` | O(1) |
| 查找 | `AIToolHandler.kt:304` | `getToolExecutorOrActivate()` | 同上 + 三级 fallback | O(1) |
| 执行 | `AIToolHandler.kt:364` | `executeTool()` | Hook 管线 → invoke() | O(n) 业务 |

### 9.2 注册 (ToolRegistration.kt → AIToolHandler.registerTool)

**入口**：`AIToolHandler.registerDefaultTools()` (行 211-218)，双重检查锁，仅首次调用时执行。

```kotlin
// AIToolHandler.kt 行 179-189
fun registerTool(name: String, descriptionGenerator: ..., executor: ToolExecutor) {
    availableTools[name] = executor  // ← ConcurrentHashMap
    toolPermissionSystem.registerOperationDescription(name, descriptionGenerator)
}
```

函数式接口重载 (行 193-208)：允许直接传 lambda：

```kotlin
fun registerTool(name: String, executor: (AITool) -> ToolResult) { ... }
```

**ToolExecutor 接口** (行 480-492)：

```kotlin
interface ToolExecutor {
    fun invoke(tool: AITool): ToolResult                                  // 同步
    fun invokeAndStream(tool: AITool): Flow<ToolResult>                   // 流式
    fun validateParameters(tool: AITool): ToolValidationResult              // 校验
}
```

**权限分层**：五个目录对应五种权限，`ToolGetter.kt` 按用户权限选择实现：
`defaultTool/standard/` → `debugger/` → `admin/` → `root/` → `accessbility/`

### 9.3 查找 (getToolExecutorOrActivate, 行 304-360)

```
getToolExecutorOrActivate("myPkg:myTool")
  │
  ├─ Level 1: availableTools["myPkg:myTool"]  → O(1) ✅
  │
  ├─ Level 2: defaultToolsRegistered == false?
  │     → registerDefaultTools() → 再查
  │
  ├─ Level 3: 名称含 ":"?
  │     → packageManager.usePackage("myPkg")  自动激活
  │     → 若是 MCP 包且失活 → 自动重激活
  │
  └─ 返回 executor 或 null
```

### 9.4 执行 (executeTool, 行 364-417) — 八步 Hook 管线

```kotlin
fun executeTool(tool: AITool): ToolResult {
    ① notifyToolCallRequested(tool)             // Hook 通知
    ② checkToolInterception(tool)               // 拦截检查 (Allow/Block)
    ③ val executor = getToolExecutorOrActivate() // 查找+懒加载+自动激活
    ④ executor.validateParameters(tool)         // 参数校验
    ⑤ notifyToolExecutionStarted(tool)          // 通知开始
    ⑥ val result = executor.invoke(tool)        // ★ 执行业务逻辑
    ⑦ notifyToolExecutionResult(tool, result)   // 通知结果
    ⑧ notifyToolExecutionFinished(tool)         // 通知结束 (finally)
    return result
}
```

### 9.5 编排层 — ToolExecutionManager

**文件**：`api/chat/enhance/ToolExecutionManager.kt` (815 行)

`object` 单例，在 `EnhancedAIService.handleToolInvocation()` 中被调用。

**executeInvocations() (行 495-678)** — 四层安全检查 + 并行/串行分组：

```
executeInvocations(invocations, toolHandler, packageManager, collector)
  │
  ├─ Layer 1 (行 531-543): 工具暴露模式检查
  │     CLI 模式 → 只允许 CLI 公开工具
  │     FULL 模式 → 拒绝 CLI 公开工具
  │
  ├─ Layer 2 (行 546-566): 角色卡工具权限检查
  │     CharacterCardToolAccessResolver → 白名单过滤
  │
  ├─ Layer 3 (行 569-605): Hook 拦截 + 用户权限弹窗
  │     checkToolInterception() + checkToolPermission()
  │
  ├─ Layer 4 (行 607-621): JS 包上下文注入
  │     injectPackageCallContext() → __operit_package_caller_name 等
  │
  ├─ 并行/串行分组 (行 623-633):
  │     可并行: list_files, read_file, find_files, grep_code, calculate,
  │             ffmpeg_info, visit_web, download_file
  │     必须串行: 其他写操作/UI 操作
  │
  ├─ async { executeAndEmitTool() }  ← 并行工具
  ├─ for { executeAndEmitTool() }    ← 串行工具
  ├─ awaitAll()
  └─ 按原始顺序聚合结果
```

---

## 十、完整数据转换管线：LLM 输出 → ToolInvocation → ToolResult → XML

### 10.1 管线五步

```
LLM 输出字符串
  │  "<tool_abc123 name=\"find_files\"><param name=\"path\">/home</param></tool_abc123>"
  │
  ▼  Step 1: ChatMarkupRegex.toolCallPattern                      正则提取工具调用块
  ▼  Step 2: MessageContentParser.toolParamPattern                正则提取参数
  ▼  Step 3: ToolExecutionManager.extractToolInvocations()        构建 ToolInvocation
  ▼  Step 4: AIToolHandler.executeTool() → executor.invoke()      执行 → ToolResult
  ▼  Step 5: ConversationMarkupManager.formatToolResultForMessage()  格式化 XML
  │
  ▼
"<tool_result_xyz789 name=\"find_files\" status=\"success\">
   <content>/home/user/doc.txt\n/home/user/data.json</content>
 </tool_result_xyz789>"
```

### 10.2 关键正则

- **工具调用标签**：`ChatMarkupRegex.toolCallPattern` — 匹配 `<tool_xxx name="...">...</tool_xxx>`
- **参数提取**：`MessageContentParser.toolParamPattern` — 匹配 `<param name="...">...</param>`
- **随机标签名**：`ChatMarkupRegex.generateRandomToolResultTagName()` — 防止 LLM 混淆

### 10.3 代码入口

| 步骤 | 文件 | 方法 | 行号 |
|------|------|------|------|
| 提取工具调用 | `ToolExecutionManager.kt` | `extractToolInvocations()` | 300-344 |
| 查找执行器 | `AIToolHandler.kt` | `getToolExecutorOrActivate()` | 304-360 |
| 执行工具 | `AIToolHandler.kt` | `executeTool()` | 364-417 |
| 编织执行 | `ToolExecutionManager.kt` | `executeInvocations()` | 495-678 |
| 单工具执行 | `ToolExecutionManager.kt` | `executeAndEmitTool()` | 683-756 |
| 格式化结果 | `ConversationMarkupManager.kt` | `formatToolResultForMessage()` | 53-82 |
| 生成 XML | `ConversationMarkupManager.kt` | `createToolResultXml()` | 135-138 |

### 10.4 并行/串行分组策略 (ToolExecutionManager.kt 行 624-633)

```kotlin
val parallelizableToolNames = setOf(
    "list_files", "read_file", "read_file_part", "read_file_full",
    "file_exists", "find_files", "file_info", "grep_code",
    "calculate", "ffmpeg_info",           // 计算/信息：可并行
    "visit_web", "download_file"          // 网络：可并行
)
// 写操作、UI 操作 → 必须串行
```

---

## 十一、PhoneAgent — 另一个 Agent Loop

**文件**：`core/tools/agent/PhoneAgent.kt`

与 Chat Agent Loop 不同，PhoneAgent 使用**显式 while 循环**：

```kotlin
// 行 507
while (_stepCount < config.maxSteps) {
    awaitIfPaused()
    result = _executeStep(null, isFirst = false)  // 截图 → AI决策 → 执行
    onStep?.invoke(result)
    if (result.finished) return result.message
}
```

单步 (`_executeStep`, 行 602)：截图 → 组装 prompt → `uiService.sendMessage()` → `parseThinkingAndAction()` → `finish()` 或 `do(action=...)` → `actionHandler.executeAgentAction()`

### 两个 Agent Loop 对比

| | Chat Agent Loop | PhoneAgent Loop |
|---|---|---|
| **文件** | `EnhancedAIService.kt` | `PhoneAgent.kt` |
| **循环形式** | 递归 + 协程链 | 显式 `while` |
| **模型** | 任意 LLM (支持 Tool Call) | 视觉模型 (AutoGLM) |
| **终止条件** | LLM 不输出工具调用标签 | AI 输出 `finish()` 或达 maxSteps |
| **步骤上限** | 无硬限制 | `config.maxSteps` |

---

## 十二、附录

### 12.1 关键文件索引

```
消息管线 (自上而下)
├── services/core/MessageCoordinationDelegate.kt    决策层, 1967行
├── services/core/MessageProcessingDelegate.kt      执行层, 1769行
├── core/chat/AIMessageManager.kt                   枢纽层, 1412行
├── api/chat/EnhancedAIService.kt                   引擎层, 3152行
└── api/chat/llmprovider/AIService.kt               传输层接口

工具系统
├── core/tools/ToolRegistration.kt                   注册, 2620行
├── core/tools/AIToolHandler.kt                      执行器管理, 492行
├── api/chat/enhance/ToolExecutionManager.kt         编排, 815行
├── api/chat/enhance/ConversationMarkupManager.kt    格式化, ~200行
└── core/tools/defaultTool/ToolGetter.kt            权限分层选择器

Agent Loop
├── api/chat/EnhancedAIService.kt                    Chat Agent Loop (递归)
└── core/tools/agent/PhoneAgent.kt                   UI 自动化 Agent (while)

配置与 Prompt
├── core/config/SystemToolPrompts.kt                 工具 prompt 定义
├── core/config/SystemPromptConfig.kt                系统提示词配置
├── core/chat/hooks/PromptHookRegistry.kt            PromptHook 注册
└── core/tools/javascript/JsTools.kt                 JS Bridge - 工具暴露给 QuickJS

数据模型
├── data/model/ChatMessage.kt
├── core/chat/hooks/PromptTurn.kt
├── data/model/AITool.kt
├── data/model/ToolInvocation.kt
└── data/model/ToolResult.kt

流处理
└── util/stream/
    ├── SharedStream / MutableSharedStream           热流实现
    ├── TextStreamEvent / TextStreamEventCarrier     Revision 事件
    └── TextStreamRevisionTracker                    回滚追踪

架构文档
├── docs/DEFAULT_TOOLS_ARCH.md                       工具修改 Checklist
├── docs/RENDERER_ARCH.md                            Markdown 渲染引擎
├── docs/JAVA_BRIDGE_INTERFACE.md                    QuickJS ↔ Java 桥
├── docs/TOOLPKG_FORMAT_GUIDE.md                     ToolPkg 格式
├── docs/SCRIPT_DEV_GUIDE.md                         脚本开发指南
└── docs/ARCHITECTURE_MESSAGE_PIPELINE.md            本文档
```

### 12.2 修改工具参数 Checklist

来源：`docs/DEFAULT_TOOLS_ARCH.md`

| # | 文件 | 要改什么 |
|---|------|---------|
| 1 | `SystemToolPrompts.kt` | 更新 schema + description |
| 2 | `ToolRegistration.kt` | 更新注册 (如 toolName/group 变更) |
| 3 | `defaultTool/standard/*` (及 debugger/admin/root/accessbility) | 更新参数读取 |
| 4 | `JsTools.kt` | 更新 JS wrapper 签名 |
| 5 | `examples/types/*.d.ts` | 更新 TypeScript 类型 |
| 6 | `examples/` | 更新示例脚本 |
| 7 | `sync_example_packages.py` | 运行同步到 assets |
| 8 | `docs/package_dev/` | 更新文档 |

### 12.3 核心设计模式

| 模式 | 体现位置 | 说明 |
|------|---------|------|
| 委托模式 | `MessageCoordinationDelegate` 持有 6 个 delegate | 每一步决策通过回调委托 |
| Hook 管线 | `PromptHookRegistry`, `AIToolHandler.toolHooks` | 外部插件可在关键节点介入 |
| 租约模式 | `MultiServiceManager.ServiceLease` | 模型实例在使用期间不被配置刷新替换 |
| 双通道 | `AIMessageManager.sendMessage()` (插件/普通) | 插件可完全替换消息处理流程 |
| 热流多播 | `SharedStream` (share/shartRevisable) | 多订阅者并发消费同一 LLM 输出 |
| 协程链递归 | `EnhancedAIService` Agent Loop | 每轮 `launch + join` 实现逻辑递归 |

### 12.4 数据转换全链路

```
ChatMessage (UI)
  → PromptTurn (AI服务)                    [AIMessageManager.getMemoryFromMessages]
  → LLM API Request (JSON)                [AIService.sendMessage]
  → LLM API Response (Stream<String>)     [AIService 流式返回]
  → ToolInvocation (结构化调用)            [ToolExecutionManager.extractToolInvocations]
  → ToolResult (执行结果)                 [AIToolHandler.executeTool]
  → tool_result XML (文本)                [ConversationMarkupManager.formatToolResultForMessage]
  → PromptTurn(kind=TOOL_RESULT)          [EnhancedAIService.processToolResults]
  → LLM API Request (下次请求含工具结果)    [递归回 Agent Loop]
  → ...最终回复 → SharedStream<String>    [全流程输出]
  → ChatMessage.content (UI)              [MessageProcessingDelegate 流收集]
```

核心设计哲学：**每一层只关心自己的抽象，上层不需要知道下层的实现细节。** `MessageCoordinationDelegate` 不知道 Agent Loop，`EnhancedAIService` 不知道 UI 如何渲染，`AIToolHandler` 不知道工具结果如何格式化为 XML 回传 LLM。

---

## 十三、常见问题速查

### Q1: 用户消息从哪里进入？

三个入口路径，最终汇聚到同一条链路：

| 入口 | 文件 | 行号 |
|------|------|------|
| **普通发送** | `services/core/MessageCoordinationDelegate.kt` | `sendUserMessage()` → `sendMessageInternal()` 行 288-350 |
| **Token 超限续写** | 同上 | `handleTokenLimitExceeded()` 行 1540-1558 → `summarizeHistory()` → `sendMessageInternal()` |
| **单条重新生成** | 同上 | `regenerateSingleAiMessage()` 行 352-466 → `messageProcessingDelegate.regenerateAiMessageVariant()` |

汇聚后的统一链路：

```
MessageCoordinationDelegate.sendMessageInternal()  (行 472)
  → MessageProcessingDelegate.sendUserMessage()    (行 552)
    → AIMessageManager.sendMessage()               (行 320)
      → EnhancedAIService.sendMessage()            (行 856)
```

### Q2: 模型工具 prompt 在哪里定义？

**文件**：`core/config/SystemToolPrompts.kt`

核心方法：
- `getAIAllCategoriesCn()` — 中文工具分类 + 描述
- `getAIAllCategoriesEn()` — 英文版本

每个工具定义为 `ToolPrompt` 对象，包含 `name`、`description`、`parametersStructured`、`details`、`notes`。

`EnhancedAIService.getAvailableToolsForFunction()` (行 2813-2952) 将这些组装为 LLM 请求中的 `tools` 参数。

### Q3: 模型输出的 `<tool>` 如何被解析？

**文件**：`api/chat/enhance/ToolExecutionManager.kt` 行 300-344

```kotlin
suspend fun extractToolInvocations(response: String): List<ToolInvocation>
```

分两步正则：
1. `ChatMarkupRegex.toolCallPattern` — 提取工具调用块：`<tool_xxx name="...">...</tool_xxx>`
2. `MessageContentParser.toolParamPattern` — 提取参数：`<param name="...">...</param>`

调用位置在 `EnhancedAIService.processStreamCompletion()` 行 1803-1808：

```kotlin
val extractedToolInvocations = ToolExecutionManager.extractToolInvocations(finalContent)
```

### Q4: toolName 如何找到 executor？

**文件**：`core/tools/AIToolHandler.kt` 行 304-360

```kotlin
fun getToolExecutorOrActivate(toolName: String): ToolExecutor?
```

三级查找：

```
Level 1: availableTools["find_files"]  → ConcurrentHashMap O(1) 直接命中
Level 2: 未找到 + 默认工具未注册 → registerDefaultTools() 懒加载 → 再查
Level 3: 名称含 ":" → packageManager.usePackage() 自动激活包 → 再查
         如果是 MCP 包且服务失活 → 自动重激活
```

存储结构：`private val availableTools = ConcurrentHashMap<String, ToolExecutor>()` (行 45)

### Q5: 权限在哪里检查？

**两层**：

**A. 工具可用性（LLM 能调用哪些工具）**
`EnhancedAIService.getAvailableToolsForFunction()` 行 2813-2952：
- 全局工具开关 → `apiPreferences.enableToolsFlow`
- 角色卡白名单 → `CharacterCardToolAccessResolver`
- CLI/标准模式 → `ToolExposureMode`

**B. 运行时权限（执行前确认）**
`ToolExecutionManager.executeInvocations()` 行 569-605：
- `checkToolInterception()` (行 574) — Hook 层拦截
- `checkToolPermission()` (行 422-484) — 用户弹窗确认
- `deny_tool` 标记可跳过权限弹窗 (行 450)

### Q6: 参数在哪里校验？

**文件**：`core/tools/AIToolHandler.kt` 行 392-404

```kotlin
val validationResult = executor.validateParameters(tool)
if (!validationResult.valid) {
    return ToolResult(error = validationResult.errorMessage)
}
```

`ToolExecutor.validateParameters()` 是接口方法 (行 489)，默认返回 `ToolValidationResult(valid=true)`，各具体工具可覆盖。

`ToolExecutionManager.executeToolSafely()` (行 387-389) 中有二次校验。

### Q7: 工具执行结果如何封装？

**三步**：

| 步骤 | 文件 | 行号 | 产出 |
|------|------|------|------|
| 执行 | `AIToolHandler.kt:408` | `executor.invoke(tool)` | `ToolResult` (含 toolName, success, result, error) |
| 格式化 | `ConversationMarkupManager.kt:53-82` | `formatToolResultForMessage()` | XML: `<tool_result_xxx name="x" status="success"><content>...</content></tool_result_xxx>` |
| 聚合 | `ToolExecutionManager.kt:738-749` | 多个中间结果合并 | 单个聚合 `ToolResult` |

### Q8: tool_result 如何回到下一轮模型输入？

**文件**：`api/chat/EnhancedAIService.kt`，精确三行：

```kotlin
// 行 2168: 格式化工具结果为 XML
val toolResultMessage = ConversationMarkupManager.buildBoundedToolResultMessage(results)

// 行 2205: 写入共享的 MutableList<PromptTurn>
context.conversationHistory.add(PromptTurn(kind = TOOL_RESULT, content = toolResultMessage))

// 行 2294: 同一 List 引用作为 chatHistory 传给 LLM
serviceForFunction.sendMessage(chatHistory = currentChatHistory, ...)
```

三步操作同一 `MutableList<PromptTurn>` 实例。`add()` 后下一次 `sendMessage()` 读到的历史已包含工具结果。

### Q9: Loop 什么时候继续，什么时候结束？

**文件**：`api/chat/EnhancedAIService.kt` `processStreamCompletion()` 行 1660-1955

| 条件 | 行号 | 行为 |
|------|------|------|
| 回复含完整 `<tool>` 标签 | 1896 | `handleToolInvocation()` → **递归继续** |
| 纯思考输出（去 think 后正文为空） | 1719 | 注入警告文本 → 回传 AI **继续** |
| 工具标签未闭合（模型输出被截断） | 1833 | 自动补齐闭合标签 → 注入警告 → **继续** |
| 普通文本回复（无工具调用） | 1932 | `finalizeAssistantResponse()` → **正常结束** |
| Token 超限 | 2270 | `onTokenLimitExceeded()` → 触发总结 → **结束当前 Loop**（由总结后的续写开启新 Loop） |
| 对话被用户取消 | 1668 | `isConversationActive=false` → 直接 return **结束** |

### Q10: Android 自动化工具在哪些目录？

| 目录 | 内容 |
|------|------|
| `core/tools/agent/` | PhoneAgent (AutoGLM)、ShowerServerManager、ShowerVideoRenderer、VirtualDisplayManager |
| `core/tools/defaultTool/standard/StandardUITools.kt` | UI 工具入口（点击、滑动、输入、圈选识屏） |
| `core/tools/defaultTool/accessbility/` | 无障碍服务实现 |
| `core/tools/defaultTool/root/` | Root 权限实现 |
| `showerclient/` | Shower ADB 自动化协议客户端库 |
| `tools/shower/` | Shower 服务端脚本（Python） |
| `tools/compose_dsl/` | Compose DSL UI 模块 |
| `integrations/tasker/` | Tasker 自动化触发集成 |

UI 自动化三条通道（在 `StandardUITools.kt` 和 `PhoneAgent.kt` 中根据设备权限自动选择）：

| 通道 | 权限级别 | 底层技术 |
|------|---------|---------|
| 无障碍 (AccessibilityService) | 最低 | Android Accessibility API |
| ADB (Shower / Shizuku) | 中等 | ADB 命令 + Shower 协议 |
| Root | 最高 | 直接系统调用，支持虚拟屏多显示器 |
