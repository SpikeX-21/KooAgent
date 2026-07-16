import assert from "node:assert/strict";
import test from "node:test";
import {
	callOperitTool,
	loadOperitConfig,
	type OperitToolCallResponse,
	stringifyArguments,
} from "../client.ts";

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

test("stringifyArguments matches the Operit Map<String, String> contract", () => {
	assert.deepEqual(
		stringifyArguments({
			duration_ms: 1,
			trace: true,
			label: "demo",
			optional: null,
			nested: { key: "value" },
		}),
		{
			duration_ms: "1",
			trace: "true",
			label: "demo",
			nested: '{"key":"value"}',
		},
	);
});

test("callOperitTool posts a correlated tool call and returns the response", async () => {
	let capturedUrl = "";
	let capturedInit: RequestInit | undefined;
	const responseBody: OperitToolCallResponse = {
		requestId: "tool-call-1",
		toolName: "sleep",
		success: true,
		resultText: "Slept for 1ms",
		startedAtMs: 1,
		finishedAtMs: 2,
		latencyMs: 1,
	};

	const result = await callOperitTool(
		{
			baseUrl: "http://127.0.0.1:8094",
			bearerToken: "secret",
			timeoutMs: 2500,
		},
		{
			requestId: "tool-call-1",
			toolName: "sleep",
			arguments: { duration_ms: 1, trace: true },
		},
		undefined,
		async (url, init) => {
			capturedUrl = String(url);
			capturedInit = init;
			return new Response(JSON.stringify(responseBody), {
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
	assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
		requestId: "tool-call-1",
		toolName: "sleep",
		arguments: { duration_ms: "1", trace: "true" },
		timeoutMs: 2500,
		trace: true,
	});
	assert.deepEqual(result, responseBody);
});

test("callOperitTool rejects unsuccessful Operit responses", async () => {
	await assert.rejects(
		callOperitTool(
			{
				baseUrl: "http://127.0.0.1:8094",
				bearerToken: "secret",
				timeoutMs: 2500,
			},
			{
				requestId: "tool-call-2",
				toolName: "tap",
				arguments: { x: 10, y: 20 },
			},
			undefined,
			async () =>
				new Response(
					JSON.stringify({
						requestId: "tool-call-2",
						toolName: "tap",
						success: false,
						resultText: "",
						error: "permission denied",
						startedAtMs: 1,
						finishedAtMs: 2,
						latencyMs: 1,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		),
		/Operit tool tap failed: permission denied/,
	);
});
