import assert from "node:assert/strict";
import test from "node:test";
import { OPERIT_TOOL_SPECS } from "../tool-specs.ts";

test("tool catalog preserves the 28 CoreCoder Operit tools", () => {
	assert.equal(OPERIT_TOOL_SPECS.length, 28);

	const names = new Set(OPERIT_TOOL_SPECS.map((spec) => spec.localName));
	assert.equal(names.size, 28);
	assert.ok(names.has("android_list_installed_apps"));
	assert.ok(names.has("android_run_ui_subagent"));
	assert.ok(names.has("android_read_file"));
	assert.ok(names.has("android_query_memory"));
});

test("UI tools keep their Operit names and required arguments", () => {
	const byName = new Map(
		OPERIT_TOOL_SPECS.map((spec) => [spec.localName, spec]),
	);

	assert.equal(byName.get("android_tap")?.remoteName, "tap");
	assert.deepEqual(requiredNames(byName.get("android_tap")), ["x", "y"]);
	assert.deepEqual(requiredNames(byName.get("android_swipe")), [
		"start_x",
		"start_y",
		"end_x",
		"end_y",
	]);
	assert.deepEqual(requiredNames(byName.get("android_press_key")), [
		"key_code",
	]);
	assert.deepEqual(requiredNames(byName.get("android_run_ui_subagent")), [
		"intent",
	]);
});

function requiredNames(
	spec: (typeof OPERIT_TOOL_SPECS)[number] | undefined,
): string[] {
	return (
		spec?.parameters
			.filter((parameter) => parameter.required)
			.map((parameter) => parameter.name) ?? []
	);
}
