export interface OperitConfig {
	baseUrl: string;
	bearerToken: string;
	timeoutMs: number;
}

export interface OperitToolCallInput {
	requestId: string;
	taskId?: string;
	stepIndex?: number;
	toolName: string;
	arguments: Record<string, unknown>;
}

export interface OperitToolCallResponse {
	requestId?: string;
	taskId?: string;
	stepIndex?: number;
	toolName: string;
	success: boolean;
	resultText: string;
	resultJson?: string;
	error?: string;
	startedAtMs: number;
	finishedAtMs: number;
	latencyMs: number;
}

export interface OperitHealthResponse {
	success: boolean;
	status: string;
	deviceRuntime?: string;
	timestampMs?: number;
	error?: string;
}

type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

// Local development defaults for the connected Operit instance. Environment
// variables still take precedence, so a different device can override them.
const DEFAULT_BASE_URL = "http://127.0.0.1:8094";
const DEFAULT_BEARER_TOKEN = "51c3ba7f20c149e499ce5de8c2e2ed0f";
const DEFAULT_TIMEOUT_MS = 15_000;

export class OperitToolCallError extends Error {
	readonly response: OperitToolCallResponse;

	constructor(response: OperitToolCallResponse) {
		super(
			`Operit tool ${response.toolName} failed: ${response.error || "unknown error"}`,
		);
		this.name = "OperitToolCallError";
		this.response = response;
	}
}

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

export function stringifyArguments(
	arguments_: Record<string, unknown>,
): Record<string, string> {
	const stringified: Record<string, string> = {};
	for (const [name, value] of Object.entries(arguments_)) {
		if (value === null || value === undefined) continue;
		if (typeof value === "string") {
			stringified[name] = value;
		} else if (
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "bigint"
		) {
			stringified[name] = String(value);
		} else {
			stringified[name] = JSON.stringify(value);
		}
	}
	return stringified;
}

export async function callOperitTool(
	config: OperitConfig,
	input: OperitToolCallInput,
	signal?: AbortSignal,
	fetchImpl: Fetch = fetch,
): Promise<OperitToolCallResponse> {
	const requestSignal = createRequestSignal(config.timeoutMs, signal);
	try {
		const response = await fetchImpl(`${config.baseUrl}/api/device/tool-call`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.bearerToken}`,
				Accept: "application/json",
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify({
				requestId: input.requestId,
				...(input.taskId ? { taskId: input.taskId } : {}),
				...(input.stepIndex === undefined
					? {}
					: { stepIndex: input.stepIndex }),
				toolName: input.toolName,
				arguments: stringifyArguments(input.arguments),
				timeoutMs: config.timeoutMs,
				trace: true,
			}),
			signal: requestSignal.signal,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Operit HTTP ${response.status}: ${body || response.statusText}`,
			);
		}

		const parsed = await parseJsonResponse<OperitToolCallResponse>(response);
		if (!parsed.success) {
			throw new OperitToolCallError(parsed);
		}
		return parsed;
	} catch (error) {
		if (requestSignal.didTimeout()) {
			throw new Error(
				`Operit tool ${input.toolName} timed out after ${config.timeoutMs}ms`,
				{ cause: error },
			);
		}
		throw error;
	} finally {
		requestSignal.cleanup();
	}
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
		return await parseJsonResponse<OperitHealthResponse>(response);
	} finally {
		requestSignal.cleanup();
	}
}

function parseTimeoutMs(raw: string | undefined): number {
	if (!raw) return DEFAULT_TIMEOUT_MS;
	const timeoutMs = Number(raw);
	if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error("OPERIT_TIMEOUT_MS must be a positive integer");
	}
	return timeoutMs;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
	const body = await response.text();
	try {
		return JSON.parse(body) as T;
	} catch (error) {
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
