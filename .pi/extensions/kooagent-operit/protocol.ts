export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface OperitTraceContext {
	sessionId: string;
	runId: string;
	turnIndex: number;
	traceId: string;
	toolCallId: string;
	executionId: string;
	attempt: number;
}

export interface OperitRemoteToolRequest {
	protocolVersion: 2;
	trace: OperitTraceContext;
	toolName: string;
	arguments: Record<string, JsonValue>;
	timeoutMs: number;
}

export type OperitExecutionStatus =
	| "SUCCEEDED"
	| "FAILED"
	| "REJECTED"
	| "TIMED_OUT"
	| "CANCELLED"
	| "UNAVAILABLE";

export type OperitErrorCategory =
	| "INVALID_REQUEST"
	| "PERMISSION"
	| "NOT_FOUND"
	| "PRECONDITION"
	| "CONFLICT"
	| "TIMEOUT"
	| "CANCELLED"
	| "UNAVAILABLE"
	| "EXECUTION"
	| "INTERNAL";

export interface OperitRemoteError {
	code: string;
	category: OperitErrorCategory;
	message: string;
	retryable: boolean;
	userActionRequired: boolean;
	data?: JsonValue;
}

export type OperitRemoteContentPart =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| {
			type: "artifact";
			artifactId: string;
			mimeType: string;
			size: number;
			sha256: string;
	  };

export interface OperitExecutionTiming {
	acceptedAtMs: number;
	startedAtMs: number;
	finishedAtMs: number;
	durationMs: number;
}

export interface OperitRuntimeInfo {
	runtimeId: string;
	deviceRuntime: "android";
	appVersion: string;
}

export interface OperitRemoteToolOutcome {
	protocolVersion: 2;
	trace: OperitTraceContext;
	toolName: string;
	status: OperitExecutionStatus;
	content: OperitRemoteContentPart[];
	data?: JsonValue;
	error?: OperitRemoteError | null;
	timing: OperitExecutionTiming;
	runtime?: OperitRuntimeInfo;
}

export interface OperitExecutionState {
	protocolVersion: 2;
	executionId: string;
	status: OperitExecutionStatus | "RUNNING" | "CANCELLATION_REQUESTED";
	outcome?: OperitRemoteToolOutcome;
}

export interface OperitHealthResponse {
	success: boolean;
	status: string;
	deviceRuntime?: string;
	timestampMs?: number;
	error?: string;
}

export function isOperitRemoteToolOutcome(
	value: unknown,
): value is OperitRemoteToolOutcome {
	if (!isRecord(value)) return false;
	return (
		value.protocolVersion === 2 &&
		typeof value.toolName === "string" &&
		isExecutionStatus(value.status) &&
		Array.isArray(value.content) &&
		value.content.every(isContentPart) &&
		isTraceContext(value.trace) &&
		(value.data === undefined || isJsonValue(value.data)) &&
		(value.error === undefined ||
			value.error === null ||
			isRemoteError(value.error)) &&
		isExecutionTiming(value.timing) &&
		(value.runtime === undefined || isRuntimeInfo(value.runtime))
	);
}

export function isOperitExecutionState(
	value: unknown,
): value is OperitExecutionState {
	if (!isRecord(value)) return false;
	return (
		value.protocolVersion === 2 &&
		typeof value.executionId === "string" &&
		(isExecutionStatus(value.status) ||
			value.status === "RUNNING" ||
			value.status === "CANCELLATION_REQUESTED") &&
		(value.outcome === undefined || isOperitRemoteToolOutcome(value.outcome))
	);
}

function isExecutionStatus(value: unknown): value is OperitExecutionStatus {
	return (
		value === "SUCCEEDED" ||
		value === "FAILED" ||
		value === "REJECTED" ||
		value === "TIMED_OUT" ||
		value === "CANCELLED" ||
		value === "UNAVAILABLE"
	);
}

function isTraceContext(value: unknown): value is OperitTraceContext {
	if (!isRecord(value)) return false;
	return (
		typeof value.sessionId === "string" &&
		typeof value.runId === "string" &&
		Number.isInteger(value.turnIndex) &&
		typeof value.traceId === "string" &&
		typeof value.toolCallId === "string" &&
		typeof value.executionId === "string" &&
		Number.isInteger(value.attempt)
	);
}

function isContentPart(value: unknown): value is OperitRemoteContentPart {
	if (!isRecord(value)) return false;
	switch (value.type) {
		case "text":
			return typeof value.text === "string";
		case "image":
			return (
				typeof value.data === "string" && typeof value.mimeType === "string"
			);
		case "artifact":
			return (
				typeof value.artifactId === "string" &&
				typeof value.mimeType === "string" &&
				typeof value.size === "number" &&
				typeof value.sha256 === "string"
			);
		default:
			return false;
	}
}

function isRemoteError(value: unknown): value is OperitRemoteError {
	if (!isRecord(value)) return false;
	return (
		typeof value.code === "string" &&
		isErrorCategory(value.category) &&
		typeof value.message === "string" &&
		typeof value.retryable === "boolean" &&
		typeof value.userActionRequired === "boolean" &&
		(value.data === undefined || isJsonValue(value.data))
	);
}

function isErrorCategory(value: unknown): value is OperitErrorCategory {
	return (
		value === "INVALID_REQUEST" ||
		value === "PERMISSION" ||
		value === "NOT_FOUND" ||
		value === "PRECONDITION" ||
		value === "CONFLICT" ||
		value === "TIMEOUT" ||
		value === "CANCELLED" ||
		value === "UNAVAILABLE" ||
		value === "EXECUTION" ||
		value === "INTERNAL"
	);
}

function isExecutionTiming(value: unknown): value is OperitExecutionTiming {
	if (!isRecord(value)) return false;
	return (
		typeof value.acceptedAtMs === "number" &&
		typeof value.startedAtMs === "number" &&
		typeof value.finishedAtMs === "number" &&
		typeof value.durationMs === "number"
	);
}

function isRuntimeInfo(value: unknown): value is OperitRuntimeInfo {
	if (!isRecord(value)) return false;
	return (
		typeof value.runtimeId === "string" &&
		value.deviceRuntime === "android" &&
		typeof value.appVersion === "string"
	);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!isRecord(value)) return false;
	return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
