import type { OperitRemoteToolOutcome } from "./protocol.ts";

export interface OperitToolExecutionPolicy {
	executionMode: "sequential" | "parallel";
	effect: "read" | "write" | "external";
	idempotency: "safe" | "keyed" | "unsafe";
	maxTransportAttempts: number;
}

export const READ_PARALLEL: OperitToolExecutionPolicy = {
	executionMode: "parallel",
	effect: "read",
	idempotency: "safe",
	maxTransportAttempts: 2,
};

export const READ_DEVICE_STATE: OperitToolExecutionPolicy = {
	executionMode: "sequential",
	effect: "read",
	idempotency: "safe",
	maxTransportAttempts: 2,
};

export const WRITE_UNSAFE: OperitToolExecutionPolicy = {
	executionMode: "sequential",
	effect: "write",
	idempotency: "unsafe",
	maxTransportAttempts: 1,
};

export const WRITE_KEYED: OperitToolExecutionPolicy = {
	executionMode: "sequential",
	effect: "write",
	idempotency: "keyed",
	maxTransportAttempts: 2,
};

export const EXTERNAL_READ: OperitToolExecutionPolicy = {
	executionMode: "parallel",
	effect: "external",
	idempotency: "safe",
	maxTransportAttempts: 2,
};

export const EXTERNAL_WRITE: OperitToolExecutionPolicy = {
	executionMode: "sequential",
	effect: "external",
	idempotency: "keyed",
	maxTransportAttempts: 2,
};

export function shouldRetryTransport(
	policy: OperitToolExecutionPolicy,
	outcome: Pick<OperitRemoteToolOutcome, "status" | "error">,
	transportAttempt: number,
): boolean {
	return (
		outcome.status === "UNAVAILABLE" &&
		outcome.error?.retryable === true &&
		policy.idempotency !== "unsafe" &&
		transportAttempt < policy.maxTransportAttempts
	);
}

export async function executeWithTransportRetry(
	policy: OperitToolExecutionPolicy,
	execute: () => Promise<OperitRemoteToolOutcome>,
	consumeRetryBudget: () => boolean,
): Promise<{
	outcome: OperitRemoteToolOutcome;
	transportAttempts: number;
}> {
	let transportAttempts = 1;
	while (true) {
		const outcome = await execute();
		if (
			!shouldRetryTransport(policy, outcome, transportAttempts) ||
			!consumeRetryBudget()
		) {
			return { outcome, transportAttempts };
		}
		transportAttempts += 1;
	}
}
