export type OperitPermissionLevel = "allow" | "ask" | "forbid";

export interface OperitPermissionSpec {
	describe(input: Record<string, unknown>): string;
}

export interface OperitPermissionRules {
	defaultLevel: OperitPermissionLevel;
	tools: Record<string, OperitPermissionLevel>;
}

export interface OperitPermissionStatus {
	projectRoot: string;
	rules: OperitPermissionRules;
}

export type PermissionPromptChoice =
	| "allow-once"
	| "always-allow"
	| "deny";

export interface PermissionPrompt {
	choose(
		title: string,
		message: string,
	): Promise<PermissionPromptChoice | undefined>;
	warn(message: string): void;
}

export interface PermissionRequest {
	cwd: string;
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	hasUI: boolean;
	prompt: PermissionPrompt;
	signal?: AbortSignal;
}

export type PermissionDecision =
	| {
			allowed: true;
			source: "rule" | "once" | "always";
			effectiveLevel: OperitPermissionLevel;
	  }
	| { allowed: false; reason: string; effectiveLevel?: OperitPermissionLevel };

export const DEFAULT_PERMISSION_RULES: OperitPermissionRules = {
	defaultLevel: "ask",
	tools: {},
};
