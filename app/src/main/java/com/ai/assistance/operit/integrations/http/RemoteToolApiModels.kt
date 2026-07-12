package com.ai.assistance.operit.integrations.http

import com.ai.assistance.operit.data.model.AITool
import com.ai.assistance.operit.data.model.ToolParameter
import kotlinx.serialization.Serializable

object RemoteToolApiContract {
    val MINIMAL_REMOTE_TOOL_ALLOWLIST = setOf(
            "list_installed_apps",
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
        val deviceRuntime: String = "android",
        val timestampMs: Long = System.currentTimeMillis(),
        val error: String? = null
)

@Serializable
data class RemoteToolCallRequest(
        val requestId: String? = null,
        val taskId: String? = null,
        val stepIndex: Int? = null,
        val toolName: String,
        val arguments: Map<String, String> = emptyMap(),
        val timeoutMs: Long? = null,
        val trace: Boolean = true
)

@Serializable
data class RemoteToolCallResponse(
        val requestId: String? = null,
        val taskId: String? = null,
        val stepIndex: Int? = null,
        val toolName: String,
        val success: Boolean,
        val resultText: String,
        val resultJson: String? = null,
        val error: String? = null,
        val startedAtMs: Long,
        val finishedAtMs: Long,
        val latencyMs: Long
)

@Serializable
data class RemoteToolListResponse(
        val success: Boolean,
        val tools: List<String>,
        val allowlist: List<String>,
        val error: String? = null
)

fun RemoteToolCallRequest.toAITool(): AITool {
    return AITool(
            name = toolName,
            parameters = arguments.map { (name, value) -> ToolParameter(name = name, value = value) }
    )
}
