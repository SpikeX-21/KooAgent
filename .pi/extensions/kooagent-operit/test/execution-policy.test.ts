import assert from "node:assert/strict";
import test from "node:test";
import {
	executeWithTransportRetry,
	type OperitToolExecutionPolicy,
	shouldRetryTransport,
} from "../execution-policy.ts";
import type { OperitRemoteToolOutcome } from "../protocol.ts";
import { OPERIT_TOOL_SPECS } from "../tool-specs.ts";

const unavailableOutcome = {
	status: "UNAVAILABLE",
	error: {
		code: "TRANSPORT_UNAVAILABLE",
		category: "UNAVAILABLE",
		message: "unavailable",
		retryable: true,
		userActionRequired: false,
	},
} as OperitRemoteToolOutcome;
const successOutcome = {
	status: "SUCCEEDED",
} as OperitRemoteToolOutcome;

test("read-only tools can retry a transient transport failure once", () => {
	const policy = policyFor("list_files");
	assert.equal(shouldRetryTransport(policy, unavailableOutcome, 1), true);
	assert.equal(shouldRetryTransport(policy, unavailableOutcome, 2), false);
});

test("state-changing tools never retry automatically", () => {
	const policy = policyFor("tap");
	assert.equal(shouldRetryTransport(policy, unavailableOutcome, 1), false);
});

test("keyed writes can repeat the same idempotent transport request", () => {
	const policy = policyFor("create_file");
	assert.equal(shouldRetryTransport(policy, unavailableOutcome, 1), true);
});

test("timeouts are never retried without querying execution state", () => {
	const policy = policyFor("get_page_info");
	assert.equal(
		shouldRetryTransport(
			policy,
			{ ...unavailableOutcome, status: "TIMED_OUT" },
			1,
		),
		false,
	);
});

test("transport retry reports how many requests were attempted", async () => {
	let calls = 0;
	const result = await executeWithTransportRetry(
		policyFor("list_files"),
		async () => {
			calls += 1;
			return calls === 1 ? unavailableOutcome : successOutcome;
		},
		() => true,
	);

	assert.equal(result.outcome.status, "SUCCEEDED");
	assert.equal(result.transportAttempts, 2);
});

test("run retry budget can prevent a policy retry", async () => {
	const result = await executeWithTransportRetry(
		policyFor("list_files"),
		async () => unavailableOutcome,
		() => false,
	);

	assert.equal(result.transportAttempts, 1);
});

function policyFor(remoteName: string): OperitToolExecutionPolicy {
	const spec = OPERIT_TOOL_SPECS.find(
		(candidate) => candidate.remoteName === remoteName,
	);
	assert.ok(spec, remoteName);
	return spec.policy;
}
