import assert from "node:assert/strict";
import test from "node:test";
import {
	ANDROID_RUNTIME_GUIDELINE,
	createOperitToolPromptGuidelines,
	createOperitToolPromptSnippet,
	requiresStateVerification,
	STATE_CHANGE_VERIFICATION_GUIDELINE,
} from "../tool-prompt.ts";
import { OPERIT_TOOL_SPECS } from "../tool-specs.ts";

test("tool snippets classify capabilities without repeating structured descriptions", () => {
	for (const spec of OPERIT_TOOL_SPECS) {
		const snippet = createOperitToolPromptSnippet(spec.policy);
		assert.notEqual(snippet, spec.description, spec.localName);
		assert.equal(snippet.includes(spec.description), false, spec.localName);
	}
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
