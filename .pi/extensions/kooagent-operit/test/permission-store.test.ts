import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FilePermissionStore } from "../permission-store.ts";

const PROJECT_ROOT = "/workspace/kooagent";
const KNOWN_TOOLS = new Set(["android_tap", "android_delete_file"]);

test("permission store persists only known tool rules", async () => {
	await withTemporaryStore(async ({ filePath }) => {
		const warnings: string[] = [];
		const store = new FilePermissionStore({
			filePath,
			knownToolNames: KNOWN_TOOLS,
			onWarning: (message) => warnings.push(message),
		});

		await store.save(PROJECT_ROOT, {
			defaultLevel: "ask",
			tools: { android_tap: "allow", android_unknown: "forbid" },
		});

		assert.deepEqual(await store.load(PROJECT_ROOT), {
			defaultLevel: "ask",
			tools: { android_tap: "allow" },
		});
		assert.match(warnings[0] ?? "", /unknown/i);
		const saved = await readFile(filePath, "utf8");
		assert.doesNotMatch(saved, /android_unknown/);
	});
});

test("missing and malformed files fail closed to ASK defaults", async () => {
	await withTemporaryStore(async ({ filePath }) => {
		const warnings: string[] = [];
		const store = new FilePermissionStore({
			filePath,
			knownToolNames: KNOWN_TOOLS,
			onWarning: (message) => warnings.push(message),
		});

		assert.deepEqual(await store.load(PROJECT_ROOT), {
			defaultLevel: "ask",
			tools: {},
		});
		await writeFile(filePath, "not json", "utf8");
		assert.deepEqual(await store.load(PROJECT_ROOT), {
			defaultLevel: "ask",
			tools: {},
		});
		assert.match(warnings[0] ?? "", /Invalid/i);
	});
});

test("saving one project preserves other project rules", async () => {
	await withTemporaryStore(async ({ filePath }) => {
		const store = new FilePermissionStore({
			filePath,
			knownToolNames: KNOWN_TOOLS,
		});
		await store.save("/workspace/one", {
			defaultLevel: "allow",
			tools: {},
		});
		await store.save("/workspace/two", {
			defaultLevel: "forbid",
			tools: { android_delete_file: "allow" },
		});

		assert.equal((await store.load("/workspace/one")).defaultLevel, "allow");
		assert.deepEqual(await store.load("/workspace/two"), {
			defaultLevel: "forbid",
			tools: { android_delete_file: "allow" },
		});
	});
});

test("concurrent rule updates preserve independent tool overrides", async () => {
	await withTemporaryStore(async ({ filePath }) => {
		const firstStore = new FilePermissionStore({ filePath, knownToolNames: KNOWN_TOOLS });
		const secondStore = new FilePermissionStore({ filePath, knownToolNames: KNOWN_TOOLS });
		await Promise.all([
			firstStore.update(PROJECT_ROOT, (rules) => ({
				...rules,
				tools: { ...rules.tools, android_tap: "allow" },
			})),
			secondStore.update(PROJECT_ROOT, (rules) => ({
				...rules,
				tools: { ...rules.tools, android_delete_file: "forbid" },
			})),
		]);

		assert.deepEqual(await firstStore.load(PROJECT_ROOT), {
			defaultLevel: "ask",
			tools: { android_tap: "allow", android_delete_file: "forbid" },
		});
	});
});

async function withTemporaryStore(
	callback: (paths: { directory: string; filePath: string }) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "kooagent-permissions-"));
	try {
		await callback({ directory, filePath: join(directory, "permissions.json") });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
