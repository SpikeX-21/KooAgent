package com.ai.assistance.operit.integrations.http

import com.ai.assistance.operit.data.model.AITool
import com.ai.assistance.operit.data.model.ToolParameter
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

object RemoteToolApiContract {
    const val PROTOCOL_VERSION = 2

    val REMOTE_TOOL_ALLOWLIST = setOf(
            "list_installed_apps",
            "start_app",
            "capture_screenshot",
            "get_page_info",
            "tap",
            "long_press",
            "swipe",
            "click_element",
            "set_input_text",
            "press_key",
            "sleep",
            "use_package",
            "list_files",
            "read_file",
            "read_file_part",
            "apply_file",
            "create_file",
            "edit_file",
            "delete_file",
            "make_directory",
            "find_files",
            "grep_code",
            "grep_context",
            "visit_web",
            "download_file",
            "query_memory",
            "get_memory_by_title"
    )
}

@Serializable
data class RemoteDeviceHealthResponse(
        val success: Boolean,
        val status: String,
        val protocolVersion: Int = RemoteToolApiContract.PROTOCOL_VERSION,
        val deviceRuntime: String = "android",
        val timestampMs: Long = System.currentTimeMillis(),
        val error: String? = null
)

@Serializable
data class RemoteTraceContext(
        val sessionId: String,
        val runId: String,
        val turnIndex: Int,
        val traceId: String,
        val toolCallId: String,
        val executionId: String,
        val attempt: Int
)

@Serializable
data class RemoteToolRequestV2(
        val protocolVersion: Int,
        val trace: RemoteTraceContext,
        val toolName: String,
        val arguments: JsonObject,
        val timeoutMs: Long
)

@Serializable
enum class RemoteToolStatus {
    SUCCEEDED,
    FAILED,
    REJECTED,
    TIMED_OUT,
    CANCELLED,
    UNAVAILABLE
}

@Serializable
enum class RemoteErrorCategory {
    INVALID_REQUEST,
    PERMISSION,
    NOT_FOUND,
    PRECONDITION,
    CONFLICT,
    TIMEOUT,
    CANCELLED,
    UNAVAILABLE,
    EXECUTION,
    INTERNAL
}

@Serializable
data class RemoteToolError(
        val code: String,
        val category: RemoteErrorCategory,
        val message: String,
        val retryable: Boolean,
        val userActionRequired: Boolean,
        val data: JsonElement? = null
)

@Serializable
sealed class RemoteContentPart {
    @Serializable
    @SerialName("text")
    data class Text(val text: String) : RemoteContentPart()

    @Serializable
    @SerialName("image")
    data class Image(val data: String, val mimeType: String) : RemoteContentPart()

    @Serializable
    @SerialName("artifact")
    data class Artifact(
            val artifactId: String,
            val mimeType: String,
            val size: Long,
            val sha256: String
    ) : RemoteContentPart()
}

@Serializable
data class RemoteExecutionTiming(
        val acceptedAtMs: Long,
        val startedAtMs: Long,
        val finishedAtMs: Long,
        val durationMs: Long
)

@Serializable
data class RemoteRuntimeInfo(
        val runtimeId: String,
        val deviceRuntime: String,
        val appVersion: String
)

@Serializable
data class RemoteToolOutcomeV2(
        val protocolVersion: Int = RemoteToolApiContract.PROTOCOL_VERSION,
        val trace: RemoteTraceContext,
        val toolName: String,
        val status: RemoteToolStatus,
        val content: List<RemoteContentPart>,
        val data: JsonElement? = null,
        val error: RemoteToolError? = null,
        val timing: RemoteExecutionTiming,
        val runtime: RemoteRuntimeInfo
)

@Serializable
data class RemoteToolListResponse(
        val success: Boolean,
        val protocolVersion: Int = RemoteToolApiContract.PROTOCOL_VERSION,
        val tools: List<String>,
        val allowlist: List<String>,
        val error: String? = null
)

@Serializable
data class RemoteExecutionStateResponse(
        val protocolVersion: Int = RemoteToolApiContract.PROTOCOL_VERSION,
        val executionId: String,
        val status: String,
        val outcome: RemoteToolOutcomeV2? = null
)

@Serializable
data class RemoteProtocolErrorResponse(
        val protocolVersion: Int = RemoteToolApiContract.PROTOCOL_VERSION,
        val error: RemoteToolError
)

fun RemoteToolRequestV2.toAITool(): AITool {
    return AITool(
            name = toolName,
            parameters = arguments.map { (name, value) ->
                ToolParameter(name = name, value = value.toToolParameterValue())
            }
    )
}

private fun JsonElement.toToolParameterValue(): String {
    return if (this is JsonPrimitive && isString) content else toString()
}
