package com.ai.assistance.operit.integrations.http

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

sealed interface RemoteExecutionAcquisition {
    data class Owner(val entry: RemoteToolExecutionEntry) : RemoteExecutionAcquisition
    data class Existing(val entry: RemoteToolExecutionEntry) : RemoteExecutionAcquisition
    data class Conflict(val existingRequest: RemoteToolRequestV2) : RemoteExecutionAcquisition
}

data class RemoteExecutionSnapshot(
        val request: RemoteToolRequestV2,
        val outcome: RemoteToolOutcomeV2?,
        val cancellationRequested: Boolean
)

class RemoteToolExecutionEntry internal constructor(val request: RemoteToolRequestV2) {
    internal val completion = CompletableFuture<RemoteToolOutcomeV2>()
    internal val cancellationRequested = AtomicBoolean(false)

    @Volatile internal var executionThread: Thread? = null
}

class RemoteToolExecutionRegistry {
    private val entries = ConcurrentHashMap<String, RemoteToolExecutionEntry>()

    fun acquire(request: RemoteToolRequestV2): RemoteExecutionAcquisition {
        pruneCompletedExecutions()
        val newEntry = RemoteToolExecutionEntry(request)
        val existing = entries.putIfAbsent(request.trace.executionId, newEntry)
                ?: return RemoteExecutionAcquisition.Owner(newEntry)
        return if (existing.request == request) {
            RemoteExecutionAcquisition.Existing(existing)
        } else {
            RemoteExecutionAcquisition.Conflict(existing.request)
        }
    }

    fun attachExecutionThread(executionId: String, thread: Thread) {
        val entry = entries[executionId] ?: return
        entry.executionThread = thread
        if (entry.cancellationRequested.get()) {
            thread.interrupt()
        }
    }

    fun complete(executionId: String, outcome: RemoteToolOutcomeV2) {
        val entry = requireNotNull(entries[executionId]) {
            "Cannot complete unknown remote execution: $executionId"
        }
        entry.executionThread = null
        entry.completion.complete(outcome)
    }

    @Throws(TimeoutException::class)
    fun await(entry: RemoteToolExecutionEntry, timeoutMs: Long): RemoteToolOutcomeV2 {
        return entry.completion.get(timeoutMs, TimeUnit.MILLISECONDS)
    }

    fun snapshot(executionId: String): RemoteExecutionSnapshot? {
        val entry = entries[executionId] ?: return null
        return RemoteExecutionSnapshot(
                request = entry.request,
                outcome = entry.completion.getNow(null),
                cancellationRequested = entry.cancellationRequested.get()
        )
    }

    fun requestCancellation(executionId: String): RemoteExecutionSnapshot? {
        val entry = entries[executionId] ?: return null
        if (!entry.completion.isDone) {
            entry.cancellationRequested.set(true)
            entry.executionThread?.interrupt()
        }
        return snapshot(executionId)
    }

    fun isCancellationRequested(executionId: String): Boolean {
        return entries[executionId]?.cancellationRequested?.get() == true
    }

    private fun pruneCompletedExecutions() {
        val overflow = entries.size - MAX_RETAINED_EXECUTIONS + 1
        if (overflow <= 0) return
        entries.entries
                .mapNotNull { entry ->
                    val outcome = entry.value.completion.getNow(null) ?: return@mapNotNull null
                    Triple(entry.key, entry.value, outcome.timing.finishedAtMs)
                }
                .sortedBy { it.third }
                .take(overflow)
                .forEach { (executionId, entry) -> entries.remove(executionId, entry) }
    }

    companion object {
        private const val MAX_RETAINED_EXECUTIONS = 512
    }
}
