import assert from "node:assert/strict";
import test from "node:test";
import { PermissionGate } from "../permission-gate.ts";
import type { PermissionStore } from "../permission-store.ts";
import type {
	OperitPermissionRules,
	PermissionPrompt,
} from "../permission-types.ts";

const PROJECT_ROOT = "/workspace/kooagent";
const TOOL_NAME = "android_tap";

test("ASK allows one tool call only after Allow once", async () => {
	const prompt = createPrompt(["allow-once"]);
	const gate = createGate(new MemoryStore());

	const decision = await authorize(gate, prompt, "call-1");

	assert.deepEqual(decision, { allowed: true, source: "once", effectiveLevel: "ask" });
	assert.equal(gate.consume("call-1"), true);
	assert.equal(gate.consume("call-1"), false);
	assert.equal(prompt.choices.length, 1);
});

test("Always allow persists a tool override for later calls", async () => {
	const store = new MemoryStore();
	const firstPrompt = createPrompt(["always-allow"]);
	const gate = createGate(store);

	assert.deepEqual(await authorize(gate, firstPrompt, "call-1"), {
		allowed: true,
		source: "always",
		effectiveLevel: "allow",
	});
	assert.equal(gate.consume("call-1"), true);
	assert.equal((await store.load(PROJECT_ROOT)).tools[TOOL_NAME], "allow");

	const nextPrompt = createPrompt([]);
	assert.deepEqual(await authorize(gate, nextPrompt, "call-2"), {
		allowed: true,
		source: "rule",
		effectiveLevel: "allow",
	});
	assert.equal(nextPrompt.choices.length, 0);
});

test("FORBID blocks without prompting", async () => {
	const store = new MemoryStore({
		defaultLevel: "ask",
		tools: { [TOOL_NAME]: "forbid" },
	});
	const prompt = createPrompt([]);
	const decision = await authorize(createGate(store), prompt, "call-1");

	assert.deepEqual(decision, {
		allowed: false,
		effectiveLevel: "forbid",
		reason: "Tool is forbidden by the project permission rule",
	});
	assert.equal(prompt.choices.length, 0);
});

test("ASK blocks in a non-interactive session", async () => {
	const prompt = createPrompt([]);
	const decision = await authorize(createGate(new MemoryStore()), prompt, "call-1", false);

	assert.deepEqual(decision, {
		allowed: false,
		effectiveLevel: "ask",
		reason: "Permission confirmation requires an interactive Pi session",
	});
	assert.equal(prompt.choices.length, 0);
});

test("unknown Android tools are denied fail-closed", async () => {
	const prompt = createPrompt([]);
	const gate = createGate(new MemoryStore());
	const decision = await gate.authorize({
		cwd: PROJECT_ROOT,
		toolCallId: "call-1",
		toolName: "android_unknown",
		input: {},
		hasUI: true,
		prompt,
	});

	assert.deepEqual(decision, {
		allowed: false,
		reason: "Unknown Android tool: android_unknown",
	});
});

test("failed Always allow persistence degrades to Allow once and warns", async () => {
	const prompt = createPrompt(["always-allow"]);
	const gate = createGate(new MemoryStore(undefined, new Error("disk unavailable")));

	assert.deepEqual(await authorize(gate, prompt, "call-1"), {
		allowed: true,
		source: "once",
		effectiveLevel: "ask",
	});
	assert.equal(gate.consume("call-1"), true);
	assert.match(prompt.warnings[0] ?? "", /could not save/i);
});

test("single-tool rules override the global default", async () => {
	const store = new MemoryStore({
		defaultLevel: "forbid",
		tools: { [TOOL_NAME]: "allow" },
	});
	const prompt = createPrompt([]);
	assert.deepEqual(await authorize(createGate(store), prompt, "call-1"), {
		allowed: true,
		source: "rule",
		effectiveLevel: "allow",
	});
});

function createGate(store: PermissionStore): PermissionGate {
	return new PermissionGate({
		store,
		permissionSpecs: new Map([
			[
				TOOL_NAME,
				{ describe: () => "Tap the Android screen." },
			],
		]),
		resolveProjectRoot: async () => PROJECT_ROOT,
	});
}

async function authorize(
	gate: PermissionGate,
	prompt: TestPrompt,
	toolCallId: string,
	hasUI = true,
) {
	return await gate.authorize({
		cwd: PROJECT_ROOT,
		toolCallId,
		toolName: TOOL_NAME,
		input: { x: 1, y: 2 },
		hasUI,
		prompt,
	});
}

class MemoryStore implements PermissionStore {
	private rules: OperitPermissionRules;
	private readonly saveError: Error | undefined;

	constructor(
		rules: OperitPermissionRules = { defaultLevel: "ask", tools: {} },
		saveError?: Error,
	) {
		this.rules = cloneRules(rules);
		this.saveError = saveError;
	}

	async load(_projectRoot: string): Promise<OperitPermissionRules> {
		return cloneRules(this.rules);
	}

	async save(_projectRoot: string, rules: OperitPermissionRules): Promise<void> {
		if (this.saveError) throw this.saveError;
		this.rules = cloneRules(rules);
	}
}

interface TestPrompt extends PermissionPrompt {
	choices: Array<"allow-once" | "always-allow" | "deny">;
	warnings: string[];
}

function createPrompt(
	choices: Array<"allow-once" | "always-allow" | "deny">,
): TestPrompt {
	const pendingChoices = [...choices];
	const selectedChoices: Array<"allow-once" | "always-allow" | "deny"> = [];
	const warnings: string[] = [];
	return {
		choices: selectedChoices,
		warnings,
		async choose(): Promise<"allow-once" | "always-allow" | "deny" | undefined> {
			const choice = pendingChoices.shift();
			if (choice) selectedChoices.push(choice);
			return choice;
		},
		warn(message: string): void {
			warnings.push(message);
		},
	};
}

function cloneRules(rules: OperitPermissionRules): OperitPermissionRules {
	return { defaultLevel: rules.defaultLevel, tools: { ...rules.tools } };
}
