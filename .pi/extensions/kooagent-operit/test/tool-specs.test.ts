import assert from "node:assert/strict";
import test from "node:test";
import { OPERIT_TOOL_SPECS } from "../tool-specs.ts";

test("tool catalog exposes the 27 supported Operit runtime tools", () => {
	const expectedEntries = [
		["android_list_installed_apps", "list_installed_apps"],
		["android_start_app", "start_app"],
		["android_capture_screenshot", "capture_screenshot"],
		["android_get_page_info", "get_page_info"],
		["android_tap", "tap"],
		["android_long_press", "long_press"],
		["android_swipe", "swipe"],
		["android_click_element", "click_element"],
		["android_set_input_text", "set_input_text"],
		["android_press_key", "press_key"],
		["android_sleep", "sleep"],
		["android_use_package", "use_package"],
		["android_list_files", "list_files"],
		["android_read_file", "read_file"],
		["android_read_file_part", "read_file_part"],
		["android_apply_file", "apply_file"],
		["android_create_file", "create_file"],
		["android_edit_file", "edit_file"],
		["android_delete_file", "delete_file"],
		["android_make_directory", "make_directory"],
		["android_find_files", "find_files"],
		["android_grep_code", "grep_code"],
		["android_grep_context", "grep_context"],
		["android_visit_web", "visit_web"],
		["android_download_file", "download_file"],
		["android_query_memory", "query_memory"],
		["android_get_memory_by_title", "get_memory_by_title"],
	];

	assert.deepEqual(
		OPERIT_TOOL_SPECS.map((spec) => [spec.localName, spec.remoteName]),
		expectedEntries,
	);
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
	assert.equal(byName.has("android_run_ui_subagent"), false);
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
