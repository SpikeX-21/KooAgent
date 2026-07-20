package com.ai.assistance.operit.integrations.http

import android.content.Context
import com.ai.assistance.operit.BuildConfig
import com.ai.assistance.operit.core.tools.AIToolHandler
import com.ai.assistance.operit.data.model.ToolResult
import com.ai.assistance.operit.util.AppLogger
import fi.iki.elonen.NanoHTTPD
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class RemoteToolApiHandler(context: Context) {
    private val toolHandler = AIToolHandler.getInstance(context.applicationContext)
    private val executionRegistry = RemoteToolExecutionRegistry()

    fun handleDeviceHealth(): NanoHTTPD.Response {
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                RemoteDeviceHealthResponse(success = true, status = "ok")
        )
    }

    fun handleListTools(): NanoHTTPD.Response {
        toolHandler.registerDefaultTools()
        val allowlist = RemoteToolApiContract.REMOTE_TOOL_ALLOWLIST.sorted()
        val tools = toolHandler.getAllToolNames().filter { it in allowlist }.sorted()
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                RemoteToolListResponse(success = true, tools = tools, allowlist = allowlist)
        )
    }

    fun handleToolCall(rawBody: String): NanoHTTPD.Response {
        if (rawBody.isBlank()) {
            return protocolError(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    "REQUEST_BODY_EMPTY",
                    "Request body is empty"
            )
        }

        val request = try {
            json.decodeFromString<RemoteToolRequestV2>(rawBody)
        } catch (e: Exception) {
            AppLogger.e(TAG, "Invalid remote tool request", e)
            return protocolError(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    "INVALID_JSON",
                    "Request is not a valid v2 remote tool request"
            )
        }

        if (request.protocolVersion != RemoteToolApiContract.PROTOCOL_VERSION) {
            return protocolError(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    "UNSUPPORTED_PROTOCOL_VERSION",
                    "protocolVersion must be ${RemoteToolApiContract.PROTOCOL_VERSION}"
            )
        }
        if (request.toolName.isBlank()) {
            return protocolError(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    "TOOL_NAME_REQUIRED",
                    "toolName is required"
            )
        }
        if (request.timeoutMs <= 0) {
            return protocolError(
                    NanoHTTPD.Response.Status.BAD_REQUEST,
                    "INVALID_TIMEOUT",
                    "timeoutMs must be positive"
            )
        }
        if (request.toolName !in RemoteToolApiContract.REMOTE_TOOL_ALLOWLIST) {
            return jsonResponse(
                    NanoHTTPD.Response.Status.FORBIDDEN,
                    createRejectedOutcome(
                            request,
                            "TOOL_NOT_ALLOWED",
                            RemoteErrorCategory.PERMISSION,
                            "Tool is not allowed for remote execution: ${request.toolName}",
                            userActionRequired = true
                    )
            )
        }

        val acceptedAtMs = System.currentTimeMillis()
        toolHandler.registerDefaultTools()
        val executor = toolHandler.getToolExecutor(request.toolName)
                ?: return jsonResponse(
                        NanoHTTPD.Response.Status.OK,
                        createRejectedOutcome(
                                request,
                                "TOOL_NOT_FOUND",
                                RemoteErrorCategory.NOT_FOUND,
                                "Tool is not registered: ${request.toolName}",
                                acceptedAtMs = acceptedAtMs
                        )
                )
        val tool = request.toAITool()
        val validation = executor.validateParameters(tool)
        if (!validation.valid) {
            return jsonResponse(
                    NanoHTTPD.Response.Status.OK,
                    createRejectedOutcome(
                            request,
                            "INVALID_ARGUMENT",
                            RemoteErrorCategory.INVALID_REQUEST,
                            validation.errorMessage,
                            acceptedAtMs = acceptedAtMs
                    )
            )
        }

        when (val acquisition = executionRegistry.acquire(request)) {
            is RemoteExecutionAcquisition.Conflict -> {
                return jsonResponse(
                        NanoHTTPD.Response.Status.CONFLICT,
                        createRejectedOutcome(
                                request,
                                "EXECUTION_ID_CONFLICT",
                                RemoteErrorCategory.CONFLICT,
                                "executionId is already associated with another request"
                        )
                )
            }
            is RemoteExecutionAcquisition.Existing -> {
                return try {
                    jsonResponse(
                            NanoHTTPD.Response.Status.OK,
                            executionRegistry.await(acquisition.entry, request.timeoutMs)
                    )
                } catch (e: TimeoutException) {
                    AppLogger.e(TAG, "Timed out waiting for existing execution", e)
                    jsonResponse(
                            NanoHTTPD.Response.Status.CONFLICT,
                            createRejectedOutcome(
                                    request,
                                    "EXECUTION_IN_PROGRESS",
                                    RemoteErrorCategory.CONFLICT,
                                    "Execution is still running: ${request.trace.executionId}"
                            )
                    )
                } catch (e: ExecutionException) {
                    AppLogger.e(TAG, "Existing execution completed exceptionally", e)
                    jsonResponse(
                            NanoHTTPD.Response.Status.INTERNAL_ERROR,
                            createRejectedOutcome(
                                    request,
                                    "EXECUTION_STATE_INVALID",
                                    RemoteErrorCategory.INTERNAL,
                                    "Stored execution did not produce an outcome"
                            )
                    )
                }
            }
            is RemoteExecutionAcquisition.Owner -> {
                executionRegistry.attachExecutionThread(
                        request.trace.executionId,
                        Thread.currentThread()
                )
            }
        }

        val startedAtMs = System.currentTimeMillis()
        return try {
            val result = runBlocking {
                withTimeout(request.timeoutMs) {
                    runInterruptible(Dispatchers.IO) { executor.invoke(tool) }
                }
            }
            val finishedAtMs = System.currentTimeMillis()
            val outcome = if (executionRegistry.isCancellationRequested(request.trace.executionId)) {
                createCancelledOutcome(request, acceptedAtMs, startedAtMs, finishedAtMs)
            } else {
                result.toRemoteOutcome(request, acceptedAtMs, startedAtMs, finishedAtMs)
            }
            completeExecution(request, outcome)
        } catch (e: TimeoutCancellationException) {
            AppLogger.e(TAG, "Remote tool execution timed out: ${request.toolName}", e)
            val finishedAtMs = System.currentTimeMillis()
            completeExecution(
                    request,
                    RemoteToolOutcomeV2(
                            trace = request.trace,
                            toolName = request.toolName,
                            status = RemoteToolStatus.TIMED_OUT,
                            content = listOf(
                                    RemoteContentPart.Text(
                                            "[EXECUTION_TIMEOUT] Tool execution exceeded ${request.timeoutMs}ms"
                                    )
                            ),
                            error = RemoteToolError(
                                    code = "EXECUTION_TIMEOUT",
                                    category = RemoteErrorCategory.TIMEOUT,
                                    message = "Tool execution exceeded ${request.timeoutMs}ms",
                                    retryable = true,
                                    userActionRequired = false
                            ),
                            timing = timing(acceptedAtMs, startedAtMs, finishedAtMs),
                            runtime = runtimeInfo()
                    )
            )
        } catch (e: Exception) {
            AppLogger.e(TAG, "Remote tool execution failed: ${request.toolName}", e)
            val finishedAtMs = System.currentTimeMillis()
            val outcome = if (executionRegistry.isCancellationRequested(request.trace.executionId)) {
                createCancelledOutcome(request, acceptedAtMs, startedAtMs, finishedAtMs)
            } else {
                RemoteToolOutcomeV2(
                            trace = request.trace,
                            toolName = request.toolName,
                            status = RemoteToolStatus.FAILED,
                            content = listOf(
                                    RemoteContentPart.Text(
                                            "[INTERNAL_ERROR] Remote tool executor threw an exception"
                                    )
                            ),
                            error = RemoteToolError(
                                    code = "INTERNAL_ERROR",
                                    category = RemoteErrorCategory.INTERNAL,
                                    message = "Remote tool executor threw an exception",
                                    retryable = false,
                                    userActionRequired = false
                            ),
                            timing = timing(acceptedAtMs, startedAtMs, finishedAtMs),
                            runtime = runtimeInfo()
                    )
            }
            completeExecution(request, outcome)
        }
    }

    fun handleExecutionStatus(executionId: String): NanoHTTPD.Response {
        val snapshot = executionRegistry.snapshot(executionId)
                ?: return protocolError(
                        NanoHTTPD.Response.Status.NOT_FOUND,
                        "EXECUTION_NOT_FOUND",
                        "Execution not found: $executionId"
                )
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                snapshot.toStateResponse()
        )
    }

    fun handleExecutionCancellation(executionId: String): NanoHTTPD.Response {
        val snapshot = executionRegistry.requestCancellation(executionId)
                ?: return protocolError(
                        NanoHTTPD.Response.Status.NOT_FOUND,
                        "EXECUTION_NOT_FOUND",
                        "Execution not found: $executionId"
                )
        return jsonResponse(
                NanoHTTPD.Response.Status.OK,
                snapshot.toStateResponse()
        )
    }

    fun handleInvalidRequest(code: String, message: String): NanoHTTPD.Response {
        return protocolError(NanoHTTPD.Response.Status.BAD_REQUEST, code, message)
    }

    private fun ToolResult.toRemoteOutcome(
            request: RemoteToolRequestV2,
            acceptedAtMs: Long,
            startedAtMs: Long,
            finishedAtMs: Long
    ): RemoteToolOutcomeV2 {
        val resultData = json.parseToJsonElement(result.toJson())
        if (success) {
            return RemoteToolOutcomeV2(
                    trace = request.trace,
                    toolName = toolName,
                    status = RemoteToolStatus.SUCCEEDED,
                    content = listOf(RemoteContentPart.Text(result.toString())),
                    data = resultData,
                    timing = timing(acceptedAtMs, startedAtMs, finishedAtMs),
                    runtime = runtimeInfo()
            )
        }

        val errorMessage = requireNotNull(error) {
            "Failed ToolResult must provide an error message: $toolName"
        }
        val remoteError = if (toolName == "use_package") {
            RemoteToolError(
                    code = "PACKAGE_ACTIVATION_FAILED",
                    category = RemoteErrorCategory.PRECONDITION,
                    message = errorMessage,
                    retryable = false,
                    userActionRequired = true
            )
        } else {
            RemoteToolError(
                    code = "TOOL_EXECUTION_FAILED",
                    category = RemoteErrorCategory.EXECUTION,
                    message = errorMessage,
                    retryable = false,
                    userActionRequired = false
            )
        }
        return RemoteToolOutcomeV2(
                trace = request.trace,
                toolName = toolName,
                status = RemoteToolStatus.FAILED,
                content = listOf(
                        RemoteContentPart.Text("[${remoteError.code}] $errorMessage")
                ),
                data = resultData,
                error = remoteError,
                timing = timing(acceptedAtMs, startedAtMs, finishedAtMs),
                runtime = runtimeInfo()
        )
    }

    private fun createRejectedOutcome(
            request: RemoteToolRequestV2,
            code: String,
            category: RemoteErrorCategory,
            message: String,
            userActionRequired: Boolean = false,
            acceptedAtMs: Long = System.currentTimeMillis()
    ): RemoteToolOutcomeV2 {
        val finishedAtMs = System.currentTimeMillis()
        return RemoteToolOutcomeV2(
                trace = request.trace,
                toolName = request.toolName,
                status = RemoteToolStatus.REJECTED,
                content = listOf(RemoteContentPart.Text("[$code] $message")),
                error = RemoteToolError(
                        code = code,
                        category = category,
                        message = message,
                        retryable = false,
                        userActionRequired = userActionRequired
                ),
                timing = timing(acceptedAtMs, acceptedAtMs, finishedAtMs),
                runtime = runtimeInfo()
        )
    }

    private fun createCancelledOutcome(
            request: RemoteToolRequestV2,
            acceptedAtMs: Long,
            startedAtMs: Long,
            finishedAtMs: Long
    ): RemoteToolOutcomeV2 {
        return RemoteToolOutcomeV2(
                trace = request.trace,
                toolName = request.toolName,
                status = RemoteToolStatus.CANCELLED,
                content = listOf(
                        RemoteContentPart.Text(
                                "[EXECUTION_CANCELLED] Tool execution was cancelled"
                        )
                ),
                error = RemoteToolError(
                        code = "EXECUTION_CANCELLED",
                        category = RemoteErrorCategory.CANCELLED,
                        message = "Tool execution was cancelled",
                        retryable = false,
                        userActionRequired = false
                ),
                timing = timing(acceptedAtMs, startedAtMs, finishedAtMs),
                runtime = runtimeInfo()
        )
    }

    private fun completeExecution(
            request: RemoteToolRequestV2,
            outcome: RemoteToolOutcomeV2
    ): NanoHTTPD.Response {
        executionRegistry.complete(request.trace.executionId, outcome)
        return jsonResponse(NanoHTTPD.Response.Status.OK, outcome)
    }

    private fun RemoteExecutionSnapshot.toStateResponse(): RemoteExecutionStateResponse {
        val state = when {
            outcome != null -> outcome.status.name
            cancellationRequested -> "CANCELLATION_REQUESTED"
            else -> "RUNNING"
        }
        return RemoteExecutionStateResponse(
                executionId = request.trace.executionId,
                status = state,
                outcome = outcome
        )
    }

    private fun protocolError(
            status: NanoHTTPD.Response.Status,
            code: String,
            message: String
    ): NanoHTTPD.Response {
        return jsonResponse(
                status,
                RemoteProtocolErrorResponse(
                        error = RemoteToolError(
                                code = code,
                                category = RemoteErrorCategory.INVALID_REQUEST,
                                message = message,
                                retryable = false,
                                userActionRequired = false
                        )
                )
        )
    }

    private fun timing(
            acceptedAtMs: Long,
            startedAtMs: Long,
            finishedAtMs: Long
    ): RemoteExecutionTiming {
        return RemoteExecutionTiming(
                acceptedAtMs = acceptedAtMs,
                startedAtMs = startedAtMs,
                finishedAtMs = finishedAtMs,
                durationMs = finishedAtMs - startedAtMs
        )
    }

    private fun runtimeInfo(): RemoteRuntimeInfo {
        return RemoteRuntimeInfo(
                runtimeId = "operit-android",
                deviceRuntime = "android",
                appVersion = BuildConfig.VERSION_NAME
        )
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
        private val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }
    }
}
