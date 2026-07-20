import assert from "node:assert/strict";
import test from "node:test";
import {
	callOperitTool,
	cancelOperitExecution,
	getOperitExecution,
	loadOperitConfig,
} from "../client.ts";
import type {
	OperitRemoteToolOutcome,
	OperitRemoteToolRequest,
} from "../protocol.ts";

const trace = {
	sessionId: "session-1",
	runId: "run-1",
	turnIndex: 2,
	traceId: "trace-1",
	toolCallId: "tool-call-1",
	executionId: "execution-1",
	attempt: 1,
};

const request: OperitRemoteToolRequest = {
	protocolVersion: 2,
	trace,
	toolName: "sleep",
	arguments: { duration_ms: 1, metadata: { source: "test" } },
	timeoutMs: 2_500,
};

const successOutcome: OperitRemoteToolOutcome = {
	protocolVersion: 2,
	trace,
	toolName: "sleep",
	status: "SUCCEEDED",
	content: [{ type: "text", text: "Slept for 1ms" }],
	data: { __type: "SleepResultData", requestedMs: 1, sleptMs: 1 },
	error: null,
	timing: {
		acceptedAtMs: 1,
		startedAtMs: 1,
		finishedAtMs: 2,
		durationMs: 1,
	},
	runtime: {
		runtimeId: "operit-android",
		deviceRuntime: "android",
		appVersion: "dev",
	},
};

test("loadOperitConfig normalizes environment configuration", () => {
	const config = loadOperitConfig({
		OPERIT_URL: "http://127.0.0.1:8094/",
		OPERIT_TOKEN: "secret",
		OPERIT_TIMEOUT_MS: "2500",
	});

	assert.deepEqual(config, {
		baseUrl: "http://127.0.0.1:8094",
		bearerToken: "secret",
		timeoutMs: 2500,
	});
});

test("callOperitTool preserves typed JSON arguments and trace context", async () => {
	let capturedUrl = "";
	let capturedInit: RequestInit | undefined;

	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async (url, init) => {
			capturedUrl = String(url);
			capturedInit = init;
			return new Response(JSON.stringify(successOutcome), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	);

	assert.equal(capturedUrl, "http://127.0.0.1:8094/api/device/tool-call");
	assert.equal(capturedInit?.method, "POST");
	assert.equal(
		new Headers(capturedInit?.headers).get("Authorization"),
		"Bearer secret",
	);
	assert.deepEqual(JSON.parse(String(capturedInit?.body)), request);
	assert.deepEqual(outcome, successOutcome);
});

test("callOperitTool preserves a structured business failure", async () => {
	const failedOutcome: OperitRemoteToolOutcome = {
		...successOutcome,
		status: "FAILED",
		content: [
			{
				type: "text",
				text: "[ACCESSIBILITY_DISABLED] Accessibility service is disabled",
			},
		],
		error: {
			code: "ACCESSIBILITY_DISABLED",
			category: "PRECONDITION",
			message: "Accessibility service is disabled",
			retryable: false,
			userActionRequired: true,
		},
	};

	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async () =>
			new Response(JSON.stringify(failedOutcome), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
	);

	assert.equal(outcome.status, "FAILED");
	assert.equal(outcome.error?.code, "ACCESSIBILITY_DISABLED");
	assert.deepEqual(outcome.trace, trace);
});

test("callOperitTool normalizes an HTTP failure without throwing", async () => {
	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async () => new Response("denied", { status: 403 }),
	);

	assert.equal(outcome.status, "REJECTED");
	assert.equal(outcome.error?.code, "HTTP_403");
	assert.deepEqual(outcome.trace, trace);
});

test("callOperitTool preserves a v2 outcome returned with HTTP conflict", async () => {
	const conflictOutcome: OperitRemoteToolOutcome = {
		...successOutcome,
		status: "REJECTED",
		content: [
			{
				type: "text",
				text: "[EXECUTION_ID_CONFLICT] execution id is already in use",
			},
		],
		error: {
			code: "EXECUTION_ID_CONFLICT",
			category: "CONFLICT",
			message: "execution id is already in use",
			retryable: false,
			userActionRequired: false,
		},
	};

	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async () =>
			new Response(JSON.stringify(conflictOutcome), {
				status: 409,
				headers: { "Content-Type": "application/json" },
			}),
	);

	assert.deepEqual(outcome, conflictOutcome);
});

test("callOperitTool rejects a response for another execution", async () => {
	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async () =>
			new Response(
				JSON.stringify({
					...successOutcome,
					trace: {
						...successOutcome.trace,
						executionId: "another-execution",
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
	);

	assert.equal(outcome.status, "FAILED");
	assert.equal(outcome.error?.code, "PROTOCOL_CORRELATION_MISMATCH");
});

test("callOperitTool normalizes an invalid response without throwing", async () => {
	const outcome = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2_500,
		},
		request,
		undefined,
		async () =>
			new Response("not-json", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
	);

	assert.equal(outcome.status, "FAILED");
	assert.equal(outcome.error?.code, "PROTOCOL_INVALID_RESPONSE");
	assert.deepEqual(outcome.trace, trace);
});

test("execution state can be queried and cancelled by execution id", async () => {
	const methods: string[] = [];
	const urls: string[] = [];
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		urls.push(String(url));
		methods.push(init?.method ?? "GET");
		return new Response(
			JSON.stringify({
				protocolVersion: 2,
				executionId: "execution/1",
				status:
					init?.method === "DELETE" ? "CANCELLATION_REQUESTED" : "RUNNING",
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};
	const config = {
		baseUrl: "http://127.0.0.1:8094",
		bearerToken: "secret",
		timeoutMs: 2_500,
	};

	const state = await getOperitExecution(config, "execution/1", fetchImpl);
	const cancelled = await cancelOperitExecution(
		config,
		"execution/1",
		fetchImpl,
	);

	assert.equal(state.status, "RUNNING");
	assert.equal(cancelled.status, "CANCELLATION_REQUESTED");
	assert.deepEqual(methods, ["GET", "DELETE"]);
	assert.deepEqual(urls, [
		"http://127.0.0.1:8094/api/device/tool-executions/execution%2F1",
		"http://127.0.0.1:8094/api/device/tool-executions/execution%2F1",
	]);
});
