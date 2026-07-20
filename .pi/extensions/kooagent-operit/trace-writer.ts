import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { OperitRemoteToolOutcome } from "./protocol.ts";

export interface OperitTraceEvent {
	event: "tool.execution.completed";
	timestampMs: number;
	traceId: string;
	runId: string;
	turnIndex: number;
	toolCallId: string;
	executionId: string;
	toolName: string;
	status: OperitRemoteToolOutcome["status"];
	transportAttempts: number;
	errorCode?: string;
	durationMs: number;
}

export async function writeOperitTrace(
	traceFile: string | undefined,
	outcome: OperitRemoteToolOutcome,
	transportAttempts: number,
): Promise<void> {
	if (!traceFile) return;
	const event: OperitTraceEvent = {
		event: "tool.execution.completed",
		timestampMs: Date.now(),
		traceId: outcome.trace.traceId,
		runId: outcome.trace.runId,
		turnIndex: outcome.trace.turnIndex,
		toolCallId: outcome.trace.toolCallId,
		executionId: outcome.trace.executionId,
		toolName: outcome.toolName,
		status: outcome.status,
		transportAttempts,
		errorCode: outcome.error?.code,
		durationMs: outcome.timing.durationMs,
	};
	try {
		await mkdir(dirname(traceFile), { recursive: true });
		await appendFile(traceFile, `${JSON.stringify(event)}\n`, "utf8");
	} catch (error) {
		console.error(`Failed to write Operit trace: ${traceFile}`, error);
	}
}
