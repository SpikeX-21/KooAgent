import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	DEFAULT_PERMISSION_RULES,
	type OperitPermissionLevel,
	type OperitPermissionRules,
} from "./permission-types.ts";

const STORE_VERSION = 1;

interface PermissionDocument {
	version: 1;
	projects: Record<string, OperitPermissionRules>;
}

export interface PermissionStore {
	load(projectRoot: string): Promise<OperitPermissionRules>;
	save(projectRoot: string, rules: OperitPermissionRules): Promise<void>;
	update?(
		projectRoot: string,
		mutate: (rules: OperitPermissionRules) => OperitPermissionRules,
	): Promise<OperitPermissionRules>;
	consumeWarnings?(): string[];
}

export interface FilePermissionStoreOptions {
	filePath?: string;
	knownToolNames: ReadonlySet<string>;
	onWarning?: (message: string) => void;
}

export class FilePermissionStore implements PermissionStore {
	private readonly filePath: string;
	private readonly knownToolNames: ReadonlySet<string>;
	private readonly onWarning: (message: string) => void;
	private readonly warnings: string[] = [];

	constructor(options: FilePermissionStoreOptions) {
		this.filePath = options.filePath ?? defaultPermissionStorePath();
		this.knownToolNames = options.knownToolNames;
		const reportWarning = options.onWarning ?? console.warn;
		this.onWarning = (message) => {
			this.warnings.push(message);
			reportWarning(message);
		};
	}

	async load(projectRoot: string): Promise<OperitPermissionRules> {
		const document = await this.readDocument();
		return cloneRules(document.projects[projectRoot] ?? DEFAULT_PERMISSION_RULES);
	}

	async save(projectRoot: string, rules: OperitPermissionRules): Promise<void> {
		await this.update(projectRoot, () => rules);
	}

	async update(
		projectRoot: string,
		mutate: (rules: OperitPermissionRules) => OperitPermissionRules,
	): Promise<OperitPermissionRules> {
		return await withStoreLock(this.filePath, async () => {
			const document = await this.readDocument();
			const rules = validateRules(
				mutate(cloneRules(document.projects[projectRoot] ?? DEFAULT_PERMISSION_RULES)),
				this.knownToolNames,
				this.onWarning,
			);
			document.projects[projectRoot] = rules;
			await writeDocument(this.filePath, document);
			return cloneRules(rules);
		});
	}

	consumeWarnings(): string[] {
		return this.warnings.splice(0);
	}

	private async readDocument(): Promise<PermissionDocument> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isFileNotFound(error)) return emptyDocument();
			this.onWarning(
				`Unable to read Operit permission settings; using ASK defaults: ${formatError(error)}`,
			);
			return emptyDocument();
		}

		try {
			return validateDocument(JSON.parse(raw), this.knownToolNames, this.onWarning);
		} catch (error) {
			this.onWarning(
				`Invalid Operit permission settings; using ASK defaults: ${formatError(error)}`,
			);
			return emptyDocument();
		}
	}
}

export function defaultPermissionStorePath(): string {
	return join(homedir(), ".pi", "agent", "kooagent-operit", "permissions.json");
}

function emptyDocument(): PermissionDocument {
	return { version: STORE_VERSION, projects: {} };
}

function validateDocument(
	value: unknown,
	knownToolNames: ReadonlySet<string>,
	onWarning: (message: string) => void,
): PermissionDocument {
	if (!isRecord(value) || value.version !== STORE_VERSION || !isRecord(value.projects)) {
		throw new Error("expected a version 1 permission document with projects");
	}

	const projects: Record<string, OperitPermissionRules> = {};
	for (const [projectRoot, rules] of Object.entries(value.projects)) {
		projects[projectRoot] = validateRules(rules, knownToolNames, onWarning);
	}
	return { version: STORE_VERSION, projects };
}

function validateRules(
	value: unknown,
	knownToolNames: ReadonlySet<string>,
	onWarning: (message: string) => void,
): OperitPermissionRules {
	if (!isRecord(value) || !isPermissionLevel(value.defaultLevel)) {
		throw new Error("expected permission rules with a valid defaultLevel");
	}
	const tools: Record<string, OperitPermissionLevel> = {};
	if (value.tools !== undefined) {
		if (!isRecord(value.tools)) throw new Error("expected tools to be an object");
		for (const [toolName, level] of Object.entries(value.tools)) {
			if (!knownToolNames.has(toolName)) {
				onWarning(`Ignoring unknown Operit permission rule: ${toolName}`);
				continue;
			}
			if (!isPermissionLevel(level)) {
				onWarning(`Ignoring invalid Operit permission level for ${toolName}`);
				continue;
			}
			tools[toolName] = level;
		}
	}
	return { defaultLevel: value.defaultLevel, tools };
}

function cloneRules(rules: OperitPermissionRules): OperitPermissionRules {
	return { defaultLevel: rules.defaultLevel, tools: { ...rules.tools } };
}

async function writeDocument(filePath: string, document: PermissionDocument): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(document, null, "\t")}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		const temporaryFile = await open(temporaryPath, "r");
		try {
			await temporaryFile.sync();
		} finally {
			await temporaryFile.close();
		}
		await rename(temporaryPath, filePath);
		await syncDirectory(dirname(filePath));
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

async function withStoreLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
	const lockPath = `${filePath}.lock`;
	await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await mkdir(lockPath, { mode: 0o700 });
			try {
				return await action();
			} finally {
				await rm(lockPath, { recursive: true, force: true });
			}
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			await delay(10);
		}
	}
	throw new Error("Timed out waiting to update Operit permission settings");
}

async function syncDirectory(directoryPath: string): Promise<void> {
	const directory = await open(directoryPath, "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

function isPermissionLevel(value: unknown): value is OperitPermissionLevel {
	return value === "allow" || value === "ask" || value === "forbid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
