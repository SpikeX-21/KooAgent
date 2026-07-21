import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type OperitPermissionLevel } from "./permission-types.ts";
import { type PermissionGate } from "./permission-gate.ts";

const LEVEL_OPTIONS: Array<{ label: string; level: OperitPermissionLevel }> = [
	{ label: "ALLOW", level: "allow" },
	{ label: "ASK", level: "ask" },
	{ label: "FORBID", level: "forbid" },
];

export async function manageOperitPermissions(
	ctx: ExtensionCommandContext,
	toolNames: readonly string[],
	permissionGate: PermissionGate,
): Promise<void> {
	try {
		if (!ctx.hasUI) {
			console.log(formatPermissionStatus(await permissionGate.getStatus(ctx.cwd), toolNames));
			return;
		}

		const action = await ctx.ui.select("Operit Android tool permissions", [
			"Show status",
			"Set global default",
			"Set tool override",
			"Clear tool override",
			"Reset current project rules",
		]);
		switch (action) {
			case "Show status":
				ctx.ui.notify(
					formatPermissionStatus(await permissionGate.getStatus(ctx.cwd), toolNames),
					"info",
				);
				return;
			case "Set global default":
				await selectGlobalDefault(ctx, permissionGate);
				return;
			case "Set tool override":
				await selectToolOverride(ctx, toolNames, permissionGate);
				return;
			case "Clear tool override":
				await clearToolOverride(ctx, toolNames, permissionGate);
				return;
			case "Reset current project rules":
				await resetRules(ctx, permissionGate);
				return;
			default:
				return;
		}
	} catch (error) {
		ctx.ui.notify(
			`Operit permission management failed: ${formatError(error)}`,
			"error",
		);
	}
}

async function selectGlobalDefault(
	ctx: ExtensionCommandContext,
	permissionGate: PermissionGate,
): Promise<void> {
	const level = await selectLevel(ctx, "Select global Android tool permission");
	if (!level) return;
	await permissionGate.setDefaultLevel(ctx.cwd, level);
	ctx.ui.notify(`Operit global permission set to ${level.toUpperCase()}`, "info");
}

async function selectToolOverride(
	ctx: ExtensionCommandContext,
	toolNames: readonly string[],
	permissionGate: PermissionGate,
): Promise<void> {
	const toolName = await ctx.ui.select("Select Android tool", [...toolNames]);
	if (!toolName) return;
	const level = await selectLevel(ctx, `Select permission for ${toolName}`);
	if (!level) return;
	await permissionGate.setToolLevel(ctx.cwd, toolName, level);
	ctx.ui.notify(`${toolName} set to ${level.toUpperCase()}`, "info");
}

async function clearToolOverride(
	ctx: ExtensionCommandContext,
	toolNames: readonly string[],
	permissionGate: PermissionGate,
): Promise<void> {
	const status = await permissionGate.getStatus(ctx.cwd);
	const configured = toolNames.filter((toolName) => status.rules.tools[toolName] !== undefined);
	if (configured.length === 0) {
		ctx.ui.notify("No Android tool overrides are configured", "info");
		return;
	}
	const toolName = await ctx.ui.select("Clear Android tool override", configured);
	if (!toolName) return;
	await permissionGate.clearToolLevel(ctx.cwd, toolName);
	ctx.ui.notify(`${toolName} now inherits the global permission`, "info");
}

async function resetRules(
	ctx: ExtensionCommandContext,
	permissionGate: PermissionGate,
): Promise<void> {
	const confirmed = await ctx.ui.confirm(
		"Reset Operit permissions?",
		"This restores the current project to ASK for every Android tool.",
	);
	if (!confirmed) return;
	await permissionGate.reset(ctx.cwd);
	ctx.ui.notify("Operit permissions reset to ASK", "info");
}

async function selectLevel(
	ctx: ExtensionCommandContext,
	title: string,
): Promise<OperitPermissionLevel | undefined> {
	const choice = await ctx.ui.select(
		title,
		LEVEL_OPTIONS.map((option) => option.label),
	);
	return LEVEL_OPTIONS.find((option) => option.label === choice)?.level;
}

function formatPermissionStatus(
	status: Awaited<ReturnType<PermissionGate["getStatus"]>>,
	toolNames: readonly string[],
): string {
	const lines = [
		`Project: ${status.projectRoot}`,
		`Global default: ${status.rules.defaultLevel.toUpperCase()}`,
		"Tool permissions:",
	];
	for (const toolName of toolNames) {
		const override = status.rules.tools[toolName];
		const effective = override ?? status.rules.defaultLevel;
		lines.push(
			`- ${toolName}: ${effective.toUpperCase()}${override ? " (override)" : " (global)"}`,
		);
	}
	return lines.join("\n");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
