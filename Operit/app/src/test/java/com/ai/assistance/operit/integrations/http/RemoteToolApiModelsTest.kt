package com.ai.assistance.operit.integrations.http

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteToolApiModelsTest {
    @Test
    fun `minimal remote allowlist exposes list installed apps`() {
        assertTrue(RemoteToolApiContract.MINIMAL_REMOTE_TOOL_ALLOWLIST.contains("list_installed_apps"))
    }

    @Test
    fun `remote allowlist exposes selected built in tools`() {
        val allowlist = RemoteToolApiContract.MINIMAL_REMOTE_TOOL_ALLOWLIST

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
        assertTrue(allowlist.contains("run_ui_subagent"))
        assertTrue(allowlist.contains("list_files"))
        assertTrue(allowlist.contains("read_file"))
        assertTrue(allowlist.contains("visit_web"))
        assertTrue(allowlist.contains("query_memory"))
        assertTrue(allowlist.contains("get_memory_by_title"))
    }

    @Test
    fun `remote tool call request converts to ai tool`() {
        val request =
                RemoteToolCallRequest(
                        requestId = "req-1",
                        taskId = "task-1",
                        stepIndex = 2,
                        toolName = "list_installed_apps",
                        arguments = mapOf("include_system" to "false")
                )

        val tool = request.toAITool()

        assertEquals("list_installed_apps", tool.name)
        assertEquals(1, tool.parameters.size)
        assertEquals("include_system", tool.parameters[0].name)
        assertEquals("false", tool.parameters[0].value)
    }
}
