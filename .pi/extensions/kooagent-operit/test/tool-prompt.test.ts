import assert from "node:assert/strict";
import test from "node:test";
import {
	ANDROID_RUNTIME_GUIDELINE,
	createOperitToolPromptGuidelines,
	requiresStateVerification,
	STATE_CHANGE_VERIFICATION_GUIDELINE,
} from "../tool-prompt.ts";
import { OPERIT_TOOL_SPECS } from "../tool-specs.ts";

test("every tool has a distinct action-oriented prompt snippet", () => {
	for (const spec of OPERIT_TOOL_SPECS) {
		assert.ok(spec.promptSnippet.length > 0, spec.localName);
		assert.notEqual(spec.promptSnippet, spec.description, spec.localName);
		assert.equal(
			spec.promptSnippet.includes(spec.description),
			false,
			spec.localName,
		);
	}
	assert.equal(
		new Set(OPERIT_TOOL_SPECS.map((spec) => spec.promptSnippet)).size,
		OPERIT_TOOL_SPECS.length,
	);

	assert.equal(
		byName("android_get_page_info").promptSnippet,
		"Inspect the current Android page and UI tree",
	);
	assert.equal(
		byName("android_click_element").promptSnippet,
		"Click an Android UI element by selector",
	);
	assert.equal(
		byName("android_query_memory").promptSnippet,
		"Reserved legacy lookup; do not use for KooAgent memory",
	);
});

test("only state-changing Android tools add a follow-up verification guideline", () => {
	for (const spec of OPERIT_TOOL_SPECS) {
		const guidelines = createOperitToolPromptGuidelines(spec.policy);
		assert.ok(guidelines.includes(ANDROID_RUNTIME_GUIDELINE), spec.localName);
		assert.equal(
			guidelines.includes(STATE_CHANGE_VERIFICATION_GUIDELINE),
			requiresStateVerification(spec.policy),
			spec.localName,
		);
	}
});

test("external writes require follow-up verification", () => {
	const download = OPERIT_TOOL_SPECS.find(
		(spec) => spec.localName === "android_download_file",
	);
	assert.ok(download);
	assert.equal(requiresStateVerification(download.policy), true);
});

function byName(name: string): (typeof OPERIT_TOOL_SPECS)[number] {
	const spec = OPERIT_TOOL_SPECS.find(
		(candidate) => candidate.localName === name,
	);
	assert.ok(spec, name);
	return spec;
}
