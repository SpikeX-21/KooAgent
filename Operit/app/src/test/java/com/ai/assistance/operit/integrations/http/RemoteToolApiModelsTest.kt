package com.ai.assistance.operit.integrations.http

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteToolApiModelsTest {
    @Test
    fun `minimal remote allowlist exposes list installed apps`() {
        assertEquals(27, RemoteToolApiContract.REMOTE_TOOL_ALLOWLIST.size)
        assertTrue(RemoteToolApiContract.REMOTE_TOOL_ALLOWLIST.contains("list_installed_apps"))
    }

    @Test
    fun `remote allowlist exposes selected built in tools`() {
        val allowlist = RemoteToolApiContract.REMOTE_TOOL_ALLOWLIST

        assertTrue(allowlist.contains("sleep"))
        assertTrue(allowlist.contains("start_app"))
        assertTrue(allowlist.contains("capture_screenshot"))
        assertTrue(allowlist.contains("get_page_info"))
        assertTrue(allowlist.contains("tap"))
        assertTrue(allowlist.contains("long_press"))
        assertTrue(allowlist.contains("swipe"))
        assertTrue(allowlist.contains("click_element"))
        assertTrue(allowlist.contains("set_input_text"))
        assertTrue(allowlist.contains("press_key"))
        assertFalse(allowlist.contains("run_ui_subagent"))
        assertTrue(allowlist.contains("list_files"))
        assertTrue(allowlist.contains("read_file"))
        assertTrue(allowlist.contains("visit_web"))
        assertTrue(allowlist.contains("query_memory"))
        assertTrue(allowlist.contains("get_memory_by_title"))
    }

    @Test
    fun `remote tool call request converts to ai tool`() {
        val request = RemoteToolRequestV2(
                protocolVersion = RemoteToolApiContract.PROTOCOL_VERSION,
                trace = RemoteTraceContext(
                        sessionId = "session-1",
                        runId = "run-1",
                        turnIndex = 2,
                        traceId = "trace-1",
                        toolCallId = "call-1",
                        executionId = "execution-1",
                        attempt = 1
                ),
                toolName = "list_installed_apps",
                arguments = buildJsonObject { put("include_system", false) },
                timeoutMs = 2_500
        )

        val tool = request.toAITool()

        assertEquals("list_installed_apps", tool.name)
        assertEquals(1, tool.parameters.size)
        assertEquals("include_system", tool.parameters[0].name)
        assertEquals("false", tool.parameters[0].value)
    }

    @Test
    fun `remote text content uses the shared type discriminator`() {
        val encoded = Json.encodeToString<RemoteContentPart>(RemoteContentPart.Text("done"))

        assertEquals("{\"type\":\"text\",\"text\":\"done\"}", encoded)
    }
}
