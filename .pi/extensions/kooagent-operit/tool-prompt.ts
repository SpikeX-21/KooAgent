import type { OperitToolExecutionPolicy } from "./execution-policy.ts";

export const ANDROID_RUNTIME_GUIDELINE =
	"Use Android tools only when the task requires the connected Operit device runtime.";

export const STATE_CHANGE_VERIFICATION_GUIDELINE =
	"After a state-changing Android action, inspect the relevant resulting state instead of assuming success.";

export function createOperitToolPromptGuidelines(
	policy: OperitToolExecutionPolicy,
): string[] {
	return requiresStateVerification(policy)
		? [ANDROID_RUNTIME_GUIDELINE, STATE_CHANGE_VERIFICATION_GUIDELINE]
		: [ANDROID_RUNTIME_GUIDELINE];
}

export function requiresStateVerification(
	policy: OperitToolExecutionPolicy,
): boolean {
	return (
		policy.effect === "write" ||
		(policy.effect === "external" && policy.idempotency !== "safe")
	);
}
