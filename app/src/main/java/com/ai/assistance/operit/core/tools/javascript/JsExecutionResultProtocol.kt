package com.ai.assistance.operit.core.tools.javascript

import org.json.JSONObject
import org.json.JSONTokener

internal fun buildJsExecutionErrorPayload(message: String): String =
    JSONObject()
        .put("success", false)
        .put("message", message.trim())
        .toString()

internal fun extractJsExecutionErrorMessage(raw: Any?): String? {
    val text = raw?.toString()?.trim().orEmpty()
    if (text.isEmpty()) {
        return null
    }
    val parsed = runCatching { JSONTokener(text).nextValue() }.getOrNull() as? JSONObject ?: return null
    if (!parsed.has("success") || parsed.optBoolean("success", true)) {
        return null
    }
    return parsed.optString("message").trim().ifEmpty { null }
}

internal fun decodeJsExecutionResultValue(raw: Any?): Any? {
    if (raw !is String) {
        return raw
    }
    val text = raw.trim()
    if (text.isEmpty()) {
        return JSONObject.NULL
    }
    return JSONTokener(text).nextValue()
}
