package com.ai.assistance.operit.integrations.http

import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteToolExecutionRegistryTest {
    @Test
    fun `same execution id and request share one execution`() {
        val registry = RemoteToolExecutionRegistry()
        val request = request("execution-1", "tap")

        assertTrue(registry.acquire(request) is RemoteExecutionAcquisition.Owner)
        assertTrue(registry.acquire(request) is RemoteExecutionAcquisition.Existing)
    }

    @Test
    fun `same execution id with different request is rejected`() {
        val registry = RemoteToolExecutionRegistry()

        registry.acquire(request("execution-1", "tap"))

        assertTrue(
                registry.acquire(request("execution-1", "swipe")) is
                        RemoteExecutionAcquisition.Conflict
        )
    }

    @Test
    fun `completed outcome is available by execution id`() {
        val registry = RemoteToolExecutionRegistry()
        val request = request("execution-1", "tap")
        registry.acquire(request)
        val outcome = rejectedOutcome(request)

        registry.complete(request.trace.executionId, outcome)

        assertEquals(outcome, registry.snapshot(request.trace.executionId)?.outcome)
    }

    private fun request(executionId: String, toolName: String): RemoteToolRequestV2 {
        return RemoteToolRequestV2(
                protocolVersion = RemoteToolApiContract.PROTOCOL_VERSION,
                trace = RemoteTraceContext(
                        sessionId = "session-1",
                        runId = "run-1",
                        turnIndex = 1,
                        traceId = "trace-1",
                        toolCallId = "call-1",
                        executionId = executionId,
                        attempt = 1
                ),
                toolName = toolName,
                arguments = buildJsonObject {},
                timeoutMs = 1_000
        )
    }

    private fun rejectedOutcome(request: RemoteToolRequestV2): RemoteToolOutcomeV2 {
        return RemoteToolOutcomeV2(
                trace = request.trace,
                toolName = request.toolName,
                status = RemoteToolStatus.REJECTED,
                content = emptyList(),
                timing = RemoteExecutionTiming(1, 1, 2, 1),
                runtime = RemoteRuntimeInfo("operit-android", "android", "test")
        )
    }
}
