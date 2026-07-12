package com.ai.assistance.operit.integrations.http

import android.content.Context
import com.ai.assistance.operit.core.tools.AIToolHandler
import com.ai.assistance.operit.util.AppLogger
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class RemoteToolApiHandler(context: Context) {
    private val appContext = context.applicationContext
    private val toolHandler = AIToolHandler.getInstance(appContext)

    fun handleDeviceHealth(): NanoHTTPD.Response {
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                RemoteDeviceHealthResponse(success = true, status = "ok")
        )
    }

    fun handleListTools(): NanoHTTPD.Response {
        toolHandler.registerDefaultTools()
        val allowlist = RemoteToolApiContract.MINIMAL_REMOTE_TOOL_ALLOWLIST.sorted()
        val tools = toolHandler.getAllToolNames().filter { it in allowlist }.sorted()
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                RemoteToolListResponse(success = true, tools = tools, allowlist = allowlist)
        )
    }

    fun handleToolCall(rawBody: String): NanoHTTPD.Response {
        if (rawBody.isBlank()) {
            return jsonResponse(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    RemoteToolErrorResponse(success = false, error = "Request body is empty")
            )
        }
        // 读取request
        val request =
                try {
                    json.decodeFromString<RemoteToolCallRequest>(rawBody)
                } catch (e: Exception) {
                    return jsonResponse(
                            NanoHTTPD.Response.Status.BAD_REQUEST,
                            RemoteToolErrorResponse(
                                    success = false,
                                    error = "Invalid JSON: ${e.message}"
                            )
                    )
                }
        // 没有工具名字
        if (request.toolName.isBlank()) {
            return jsonResponse(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    RemoteToolErrorResponse(success = false, error = "toolName is required")
            )
        }

        if (request.toolName !in RemoteToolApiContract.MINIMAL_REMOTE_TOOL_ALLOWLIST) {
            return jsonResponse(
                    NanoHTTPD.Response.Status.FORBIDDEN,
                    RemoteToolErrorResponse(
                            success = false,
                            toolName = request.toolName,
                            error = "Tool is not allowed for remote execution: ${request.toolName}"
                    )
            )
        }

        val startedAtMs = System.currentTimeMillis()
        return try {
            val result =
                    runBlocking {
                        withContext(Dispatchers.IO) {
                            toolHandler.registerDefaultTools()
                            toolHandler.executeTool(request.toAITool())
                        }
                    }
            val finishedAtMs = System.currentTimeMillis()
            jsonResponse(
                    NanoHTTPD.Response.Status.OK,
                    RemoteToolCallResponse(
                            requestId = request.requestId,
                            taskId = request.taskId,
                            stepIndex = request.stepIndex,
                            toolName = result.toolName,
                            success = result.success,
                            resultText = result.result.toString(),
                            resultJson = runCatching { result.result.toJson() }.getOrNull(),
                            error = result.error,
                            startedAtMs = startedAtMs,
                            finishedAtMs = finishedAtMs,
                            latencyMs = finishedAtMs - startedAtMs
                    )
            )
        } catch (e: Exception) {
            AppLogger.e(TAG, "Remote tool execution failed: ${request.toolName}", e)
            val finishedAtMs = System.currentTimeMillis()
            jsonResponse(
                    NanoHTTPD.Response.Status.INTERNAL_ERROR,
                    RemoteToolCallResponse(
                            requestId = request.requestId,
                            taskId = request.taskId,
                            stepIndex = request.stepIndex,
                            toolName = request.toolName,
                            success = false,
                            resultText = "",
                            error = e.message ?: "Unknown error",
                            startedAtMs = startedAtMs,
                            finishedAtMs = finishedAtMs,
                            latencyMs = finishedAtMs - startedAtMs
                    )
            )
        }
    }

    private inline fun <reified T> jsonResponse(
            status: NanoHTTPD.Response.Status,
            body: T
    ): NanoHTTPD.Response {
        return NanoHTTPD.newFixedLengthResponse(status, JSON_MIME_TYPE, json.encodeToString(body))
    }

    companion object {
        private const val TAG = "RemoteToolApiHandler"
        private const val JSON_MIME_TYPE = "application/json; charset=utf-8"
        private val json = Json { ignoreUnknownKeys = true }
    }
}

@Serializable
private data class RemoteToolErrorResponse(
        val success: Boolean,
        val toolName: String? = null,
        val error: String
)
