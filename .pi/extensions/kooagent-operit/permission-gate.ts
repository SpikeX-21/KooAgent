import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	DEFAULT_PERMISSION_RULES,
	type OperitPermissionLevel,
	type OperitPermissionRules,
	type OperitPermissionSpec,
	type OperitPermissionStatus,
	type PermissionDecision,
	type PermissionRequest,
} from "./permission-types.ts";
import type { PermissionStore } from "./permission-store.ts";

export interface PermissionGateOptions {
	store: PermissionStore;
	permissionSpecs: ReadonlyMap<string, OperitPermissionSpec>;
	resolveProjectRoot?: (cwd: string) => Promise<string>;
}

export class PermissionGate {
	private readonly store: PermissionStore;
	private readonly permissionSpecs: ReadonlyMap<string, OperitPermissionSpec>;
	private readonly resolveProjectRoot: (cwd: string) => Promise<string>;
	private readonly authorizedToolCallIds = new Set<string>();
	private projectRoot: string | undefined;
	private rules: OperitPermissionRules = cloneRules(DEFAULT_PERMISSION_RULES);
	private loading: Promise<void> | undefined;

	constructor(options: PermissionGateOptions) {
		this.store = options.store;
		this.permissionSpecs = options.permissionSpecs;
		this.resolveProjectRoot = options.resolveProjectRoot ?? canonicalProjectRoot;
	}

	async authorize(request: PermissionRequest): Promise<PermissionDecision> {
		if (request.signal?.aborted) {
			return { allowed: false, reason: "Permission confirmation was cancelled" };
		}
		const spec = this.permissionSpecs.get(request.toolName);
		if (!spec) {
			return {
				allowed: false,
				reason: `Unknown Android tool: ${request.toolName}`,
			};
		}
		await this.ensureProject(await this.resolveProjectRoot(request.cwd));
		for (const warning of this.store.consumeWarnings?.() ?? []) {
			request.prompt.warn(warning);
		}
		const level = this.rules.tools[request.toolName] ?? this.rules.defaultLevel;
		if (level === "allow") return this.allow(request.toolCallId, "rule", level);
		if (level === "forbid") {
			return {
				allowed: false,
				effectiveLevel: level,
				reason: "Tool is forbidden by the project permission rule",
			};
		}
		if (!request.hasUI) {
			return {
				allowed: false,
				effectiveLevel: level,
				reason: "Permission confirmation requires an interactive Pi session",
			};
		}

		const choice = await request.prompt.choose(
			"Allow Android tool?",
			`${spec.describe(request.input)}\n\nTool: ${request.toolName}`,
		);
		if (request.signal?.aborted) {
			return { allowed: false, effectiveLevel: level, reason: "Permission confirmation was cancelled" };
		}
		switch (choice) {
			case "allow-once":
				return this.allow(request.toolCallId, "once", level);
			case "always-allow":
				return await this.alwaysAllow(request);
			default:
				return { allowed: false, effectiveLevel: level, reason: "Denied by user" };
		}
	}

	consume(toolCallId: string): boolean {
		return this.authorizedToolCallIds.delete(toolCallId);
	}

	clearSession(): void {
		this.authorizedToolCallIds.clear();
	}

	async getStatus(cwd: string): Promise<OperitPermissionStatus> {
		const projectRoot = await this.resolveProjectRoot(cwd);
		await this.ensureProject(projectRoot);
		return { projectRoot, rules: cloneRules(this.rules) };
	}

	async setDefaultLevel(cwd: string, level: OperitPermissionLevel): Promise<void> {
		const projectRoot = await this.resolveProjectRoot(cwd);
		await this.ensureProject(projectRoot);
		await this.updateRules((rules) => ({ ...rules, defaultLevel: level }));
	}

	async setToolLevel(
		cwd: string,
		toolName: string,
		level: OperitPermissionLevel,
	): Promise<void> {
		if (!this.permissionSpecs.has(toolName)) {
			throw new Error(`Unknown Android tool: ${toolName}`);
		}
		const projectRoot = await this.resolveProjectRoot(cwd);
		await this.ensureProject(projectRoot);
		await this.updateRules((rules) => ({
			...rules,
			tools: { ...rules.tools, [toolName]: level },
		}));
	}

	async clearToolLevel(cwd: string, toolName: string): Promise<void> {
		const projectRoot = await this.resolveProjectRoot(cwd);
		await this.ensureProject(projectRoot);
		await this.updateRules((rules) => {
			const { [toolName]: _removed, ...tools } = rules.tools;
			return { ...rules, tools };
		});
	}

	async reset(cwd: string): Promise<void> {
		const projectRoot = await this.resolveProjectRoot(cwd);
		await this.ensureProject(projectRoot);
		await this.updateRules(() => cloneRules(DEFAULT_PERMISSION_RULES));
	}

	private allow(
		toolCallId: string,
		source: "rule" | "once" | "always",
		effectiveLevel: OperitPermissionLevel,
	): PermissionDecision {
		this.authorizedToolCallIds.add(toolCallId);
		return { allowed: true, source, effectiveLevel };
	}

	private async alwaysAllow(request: PermissionRequest): Promise<PermissionDecision> {
		try {
			await this.updateRules((rules) => ({
				...rules,
				tools: { ...rules.tools, [request.toolName]: "allow" },
			}));
			return this.allow(request.toolCallId, "always", "allow");
		} catch (error) {
			request.prompt.warn(
				`Allowed once, but could not save the permission rule: ${formatError(error)}`,
			);
			return this.allow(request.toolCallId, "once", "ask");
		}
	}

	private async ensureProject(projectRoot: string): Promise<void> {
		if (this.projectRoot === projectRoot) {
			if (this.loading) await this.loading;
			return;
		}
		this.projectRoot = projectRoot;
		this.authorizedToolCallIds.clear();
		this.loading = this.store.load(projectRoot).then((rules) => {
			this.rules = cloneRules(rules);
		});
		try {
			await this.loading;
		} finally {
			this.loading = undefined;
		}
	}

	private async updateRules(
		mutate: (rules: OperitPermissionRules) => OperitPermissionRules,
	): Promise<void> {
		const previousRules = this.rules;
		try {
			if (!this.projectRoot) throw new Error("Permission project has not been initialized");
			if (this.store.update) {
				this.rules = await this.store.update(this.projectRoot, mutate);
			} else {
				this.rules = mutate(cloneRules(this.rules));
				await this.store.save(this.projectRoot, this.rules);
			}
			this.authorizedToolCallIds.clear();
		} catch (error) {
			this.rules = previousRules;
			throw error;
		}
	}
}

async function canonicalProjectRoot(cwd: string): Promise<string> {
	try {
		return await realpath(cwd);
	} catch {
		return resolve(cwd);
	}
}

function cloneRules(rules: OperitPermissionRules): OperitPermissionRules {
	return { defaultLevel: rules.defaultLevel, tools: { ...rules.tools } };
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
