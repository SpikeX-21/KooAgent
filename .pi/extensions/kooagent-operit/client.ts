import {
	isOperitExecutionState,
	isOperitRemoteToolOutcome,
	type OperitExecutionState,
	type OperitHealthResponse,
	type OperitRemoteError,
	type OperitRemoteToolOutcome,
	type OperitRemoteToolRequest,
} from "./protocol.ts";

export interface OperitConfig {
	baseUrl: string;
	bearerToken: string;
	timeoutMs: number;
}

type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const DEFAULT_BASE_URL = "http://127.0.0.1:8094";
const DEFAULT_BEARER_TOKEN = "51c3ba7f20c149e499ce5de8c2e2ed0f";
const DEFAULT_TIMEOUT_MS = 15_000;

export function loadOperitConfig(
	env: NodeJS.ProcessEnv = process.env,
): OperitConfig {
	const baseUrl = (env.OPERIT_URL || DEFAULT_BASE_URL)
		.trim()
		.replace(/\/+$/, "");
	const bearerToken = (env.OPERIT_TOKEN || DEFAULT_BEARER_TOKEN).trim();
	const timeoutMs = parseTimeoutMs(env.OPERIT_TIMEOUT_MS);

	const url = new URL(baseUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("OPERIT_URL must use http or https");
	}
	if (!bearerToken) {
		throw new Error("OPERIT_TOKEN is required to call the Android runtime");
	}

	return { baseUrl, bearerToken, timeoutMs };
}

export async function callOperitTool(
	config: OperitConfig,
	request: OperitRemoteToolRequest,
	signal?: AbortSignal,
	fetchImpl: Fetch = fetch,
): Promise<OperitRemoteToolOutcome> {
	const acceptedAtMs = Date.now();
	const requestSignal = createRequestSignal(config.timeoutMs, signal);
	const cancelRemoteExecution = () => {
		void cancelOperitExecution(
			config,
			request.trace.executionId,
			fetchImpl,
		).catch((error) => {
			console.error(
				`Failed to cancel Operit execution: ${request.trace.executionId}`,
				error,
			);
		});
	};
	signal?.addEventListener("abort", cancelRemoteExecution, { once: true });
	try {
		const response = await fetchImpl(`${config.baseUrl}/api/device/tool-call`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.bearerToken}`,
				Accept: "application/json",
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify(request),
			signal: requestSignal.signal,
		});

		const body = await response.text();
		const parsedBody = parseJson(body);
		if (!response.ok) {
			console.error(
				`Operit HTTP request failed: status=${response.status} executionId=${request.trace.executionId}`,
			);
			if (isOperitRemoteToolOutcome(parsedBody)) {
				return validateCorrelatedOutcome(request, parsedBody, acceptedAtMs);
			}
			const unavailable = response.status === 429 || response.status >= 500;
			return createLocalFailure(
				request,
				acceptedAtMs,
				unavailable ? "UNAVAILABLE" : "REJECTED",
				{
					code: `HTTP_${response.status}`,
					category:
						response.status === 401 || response.status === 403
							? "PERMISSION"
							: response.status === 404
								? "NOT_FOUND"
								: response.status === 409
									? "CONFLICT"
									: unavailable
										? "UNAVAILABLE"
										: "INVALID_REQUEST",
					message: body || `Operit returned HTTP ${response.status}`,
					retryable: unavailable,
					userActionRequired:
						response.status === 401 || response.status === 403,
				},
			);
		}

		if (parsedBody === undefined) {
			console.error("Operit returned invalid JSON");
			return createLocalFailure(request, acceptedAtMs, "FAILED", {
				code: "PROTOCOL_INVALID_RESPONSE",
				category: "INVALID_REQUEST",
				message: "Operit returned a non-JSON response",
				retryable: false,
				userActionRequired: false,
			});
		}

		if (!isOperitRemoteToolOutcome(parsedBody)) {
			console.error(
				`Operit returned an invalid v2 outcome: executionId=${request.trace.executionId}`,
			);
			return createLocalFailure(request, acceptedAtMs, "FAILED", {
				code: "PROTOCOL_INVALID_RESPONSE",
				category: "INVALID_REQUEST",
				message: "Operit returned an invalid v2 tool outcome",
				retryable: false,
				userActionRequired: false,
			});
		}

		return validateCorrelatedOutcome(request, parsedBody, acceptedAtMs);
	} catch (error) {
		console.error(
			`Operit transport failed: executionId=${request.trace.executionId}`,
			error,
		);
		if (requestSignal.didTimeout()) {
			try {
				const state = await getOperitExecution(
					config,
					request.trace.executionId,
					fetchImpl,
				);
				if (state.outcome) return state.outcome;
			} catch (queryError) {
				console.error(
					`Failed to query timed-out Operit execution: ${request.trace.executionId}`,
					queryError,
				);
			}
			return createLocalFailure(request, acceptedAtMs, "TIMED_OUT", {
				code: "CLIENT_TIMEOUT",
				category: "TIMEOUT",
				message: `Operit request timed out after ${config.timeoutMs}ms`,
				retryable: true,
				userActionRequired: false,
			});
		}
		if (signal?.aborted) {
			return createLocalFailure(request, acceptedAtMs, "CANCELLED", {
				code: "CLIENT_CANCELLED",
				category: "CANCELLED",
				message: "Operit request was cancelled",
				retryable: false,
				userActionRequired: false,
			});
		}
		return createLocalFailure(request, acceptedAtMs, "UNAVAILABLE", {
			code: "TRANSPORT_UNAVAILABLE",
			category: "UNAVAILABLE",
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
			userActionRequired: false,
		});
	} finally {
		signal?.removeEventListener("abort", cancelRemoteExecution);
		requestSignal.cleanup();
	}
}

function parseJson(body: string): unknown | undefined {
	try {
		return JSON.parse(body);
	} catch (error) {
		console.error("Failed to parse Operit JSON response", error);
		return undefined;
	}
}

export async function getOperitExecution(
	config: OperitConfig,
	executionId: string,
	fetchImpl: Fetch = fetch,
): Promise<OperitExecutionState> {
	const response = await fetchImpl(
		`${config.baseUrl}/api/device/tool-executions/${encodeURIComponent(executionId)}`,
		{
			headers: {
				Authorization: `Bearer ${config.bearerToken}`,
				Accept: "application/json",
			},
		},
	);
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`Operit execution query failed with HTTP ${response.status}: ${body}`,
		);
	}
	const parsed = parseJson(body);
	if (!isOperitExecutionState(parsed)) {
		throw new Error("Operit returned an invalid execution state response");
	}
	if (
		parsed.executionId !== executionId ||
		(parsed.outcome !== undefined &&
			parsed.outcome.trace.executionId !== executionId)
	) {
		throw new Error("Operit execution state correlation mismatch");
	}
	return parsed;
}

export async function cancelOperitExecution(
	config: OperitConfig,
	executionId: string,
	fetchImpl: Fetch = fetch,
): Promise<OperitExecutionState> {
	const response = await fetchImpl(
		`${config.baseUrl}/api/device/tool-executions/${encodeURIComponent(executionId)}`,
		{
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${config.bearerToken}`,
				Accept: "application/json",
			},
		},
	);
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`Operit execution cancellation failed with HTTP ${response.status}: ${body}`,
		);
	}
	const parsed = parseJson(body);
	if (!isOperitExecutionState(parsed)) {
		throw new Error("Operit returned an invalid cancellation response");
	}
	if (parsed.executionId !== executionId) {
		throw new Error("Operit cancellation correlation mismatch");
	}
	return parsed;
}

export async function getOperitHealth(
	config: OperitConfig,
	signal?: AbortSignal,
	fetchImpl: Fetch = fetch,
): Promise<OperitHealthResponse> {
	const requestSignal = createRequestSignal(config.timeoutMs, signal);
	try {
		const response = await fetchImpl(`${config.baseUrl}/api/device/health`, {
			headers: {
				Authorization: `Bearer ${config.bearerToken}`,
				Accept: "application/json",
			},
			signal: requestSignal.signal,
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Operit HTTP ${response.status}: ${body || response.statusText}`,
			);
		}
		return await parseHealthResponse(response);
	} catch (error) {
		console.error("Operit health check failed", error);
		throw error;
	} finally {
		requestSignal.cleanup();
	}
}

function createLocalFailure(
	request: OperitRemoteToolRequest,
	acceptedAtMs: number,
	status: OperitRemoteToolOutcome["status"],
	error: OperitRemoteError,
): OperitRemoteToolOutcome {
	const finishedAtMs = Date.now();
	return {
		protocolVersion: 2,
		trace: request.trace,
		toolName: request.toolName,
		status,
		content: [{ type: "text", text: `[${error.code}] ${error.message}` }],
		error,
		timing: {
			acceptedAtMs,
			startedAtMs: acceptedAtMs,
			finishedAtMs,
			durationMs: finishedAtMs - acceptedAtMs,
		},
	};
}

function validateCorrelatedOutcome(
	request: OperitRemoteToolRequest,
	outcome: OperitRemoteToolOutcome,
	acceptedAtMs: number,
): OperitRemoteToolOutcome {
	const correlated =
		outcome.toolName === request.toolName &&
		outcome.trace.sessionId === request.trace.sessionId &&
		outcome.trace.runId === request.trace.runId &&
		outcome.trace.turnIndex === request.trace.turnIndex &&
		outcome.trace.traceId === request.trace.traceId &&
		outcome.trace.toolCallId === request.trace.toolCallId &&
		outcome.trace.executionId === request.trace.executionId &&
		outcome.trace.attempt === request.trace.attempt;
	if (correlated) return outcome;
	console.error(
		`Operit response correlation mismatch: executionId=${request.trace.executionId}`,
	);
	return createLocalFailure(request, acceptedAtMs, "FAILED", {
		code: "PROTOCOL_CORRELATION_MISMATCH",
		category: "INVALID_REQUEST",
		message: "Operit response did not match the requested execution",
		retryable: false,
		userActionRequired: false,
	});
}

function parseTimeoutMs(raw: string | undefined): number {
	if (!raw) return DEFAULT_TIMEOUT_MS;
	const timeoutMs = Number(raw);
	if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error("OPERIT_TIMEOUT_MS must be a positive integer");
	}
	return timeoutMs;
}

async function parseHealthResponse(
	response: Response,
): Promise<OperitHealthResponse> {
	const body = await response.text();
	try {
		return JSON.parse(body) as OperitHealthResponse;
	} catch (error) {
		console.error("Operit returned an invalid health response", error);
		throw new Error(`Operit returned invalid JSON: ${body}`, { cause: error });
	}
}

function createRequestSignal(
	timeoutMs: number,
	parentSignal?: AbortSignal,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	timeout.unref();

	const abortFromParent = () => controller.abort(parentSignal?.reason);
	if (parentSignal?.aborted) {
		abortFromParent();
	} else {
		parentSignal?.addEventListener("abort", abortFromParent, { once: true });
	}

	return {
		signal: controller.signal,
		didTimeout: () => timedOut,
		cleanup: () => {
			clearTimeout(timeout);
			parentSignal?.removeEventListener("abort", abortFromParent);
		},
	};
}
