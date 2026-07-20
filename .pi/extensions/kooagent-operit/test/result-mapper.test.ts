import assert from "node:assert/strict";
import test from "node:test";
import type { OperitRemoteToolOutcome } from "../protocol.ts";
import {
	createAgentToolResult,
	isOperitToolDetails,
} from "../result-mapper.ts";

const outcome: OperitRemoteToolOutcome = {
	protocolVersion: 2,
	trace: {
		sessionId: "session-1",
		runId: "run-1",
		turnIndex: 1,
		traceId: "trace-1",
		toolCallId: "call-1",
		executionId: "execution-1",
		attempt: 1,
	},
	toolName: "tap",
	status: "FAILED",
	content: [{ type: "text", text: "[PRECONDITION_FAILED] No focused window" }],
	error: {
		code: "PRECONDITION_FAILED",
		category: "PRECONDITION",
		message: "No focused window",
		retryable: false,
		userActionRequired: false,
	},
	timing: {
		acceptedAtMs: 1,
		startedAtMs: 2,
		finishedAtMs: 3,
		durationMs: 1,
	},
};

test("result mapper exposes structured recovery fields to the model for failures", () => {
	const result = createAgentToolResult(outcome);

	assert.deepEqual(result.content, [
		{
			type: "text",
			text: [
				"[OPERIT_TOOL_ERROR]",
				"status=FAILED",
				"code=PRECONDITION_FAILED",
				"category=PRECONDITION",
				"retryable=false",
				"userActionRequired=false",
				'message="No focused window"',
			].join("\n"),
		},
		...outcome.content,
	]);
	assert.equal(result.details.kind, "operit-tool-result");
	assert.deepEqual(result.details.outcome, outcome);
	assert.equal(isOperitToolDetails(result.details), true);
});

test("result mapper supplies conservative recovery fields when remote error is missing", () => {
	const result = createAgentToolResult({ ...outcome, error: undefined });

	assert.deepEqual(result.content[0], {
		type: "text",
		text: [
			"[OPERIT_TOOL_ERROR]",
			"status=FAILED",
			"code=REMOTE_ERROR_UNSPECIFIED",
			"category=INTERNAL",
			"retryable=false",
			"userActionRequired=false",
			'message="Remote tool returned FAILED without structured error details"',
		].join("\n"),
	});
});

test("result mapper bounds the model error summary message", () => {
	const structuredError = outcome.error;
	assert.ok(structuredError);
	const result = createAgentToolResult({
		...outcome,
		error: { ...structuredError, message: "x".repeat(10_000) },
	});
	const summary = result.content[0];

	assert.equal(summary.type, "text");
	assert.ok(summary.text.length < 1_300);
	assert.match(summary.text, /… \[truncated\]"$/);
});

test("result mapper converts artifact references into model-visible text", () => {
	const result = createAgentToolResult({
		...outcome,
		status: "SUCCEEDED",
		error: undefined,
		content: [
			{
				type: "artifact",
				artifactId: "screen-1",
				mimeType: "image/png",
				size: 42,
				sha256: "abc",
			},
		],
	});

	assert.deepEqual(result.content, [
		{
			type: "text",
			text: "[artifact screen-1] image/png, 42 bytes, sha256=abc",
		},
	]);
});

test("details guard rejects unrelated tool details", () => {
	assert.equal(isOperitToolDetails({ kind: "another-tool" }), false);
});

test("result mapper omits oversized structured data from session details", () => {
	const result = createAgentToolResult({
		...outcome,
		data: { content: "x".repeat(40_000) },
	});

	assert.equal(result.details.outcome.data, undefined);
	assert.ok(result.details.omittedData);
	assert.ok(result.details.omittedData.encodedChars > 40_000);
});
