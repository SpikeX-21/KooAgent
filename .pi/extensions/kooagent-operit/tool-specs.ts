import {
	EXTERNAL_READ,
	EXTERNAL_WRITE,
	type OperitToolExecutionPolicy,
	READ_DEVICE_STATE,
	READ_PARALLEL,
	WRITE_KEYED,
	WRITE_UNSAFE,
} from "./execution-policy.ts";
import type { OperitPermissionSpec } from "./permission-types.ts";

export type OperitParameterKind = "string" | "integer" | "number" | "boolean";

export interface OperitParameterSpec {
	name: string;
	kind: OperitParameterKind;
	description: string;
	required?: boolean;
}

export interface OperitToolSpec {
	localName: string;
	remoteName: string;
	description: string;
	parameters: OperitParameterSpec[];
	policy: OperitToolExecutionPolicy;
	permission: OperitPermissionSpec;
}

type OperitToolSpecDefinition = Omit<OperitToolSpec, "permission">;

const parameter = (
	name: string,
	kind: OperitParameterKind,
	description: string,
	required = false,
): OperitParameterSpec => ({ name, kind, description, required });

const OPERIT_TOOL_SPEC_DEFINITIONS: OperitToolSpecDefinition[] = [
	{
		localName: "android_list_installed_apps",
		remoteName: "list_installed_apps",
		policy: READ_PARALLEL,
		description: "List installed third-party Android apps through Operit.",
		parameters: [],
	},
	{
		localName: "android_start_app",
		remoteName: "start_app",
		policy: WRITE_UNSAFE,
		description:
			"Launch an installed Android app by package name through Operit.",
		parameters: [
			parameter(
				"package_name",
				"string",
				"Android package name, e.g. com.android.settings",
				true,
			),
		],
	},
	{
		localName: "android_capture_screenshot",
		remoteName: "capture_screenshot",
		policy: READ_DEVICE_STATE,
		description:
			"Capture the current Android screen through Operit and return the screenshot path.",
		parameters: [],
	},
	{
		localName: "android_get_page_info",
		remoteName: "get_page_info",
		policy: READ_DEVICE_STATE,
		description:
			"Get current Android page/window UI information through Operit.",
		parameters: [
			parameter(
				"format",
				"string",
				"Optional response format: xml or json; defaults to xml",
			),
			parameter(
				"detail",
				"string",
				"Optional detail level; defaults to summary",
			),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_tap",
		remoteName: "tap",
		policy: WRITE_UNSAFE,
		description: "Tap a point on the Android screen through Operit.",
		parameters: [
			parameter("x", "integer", "X coordinate in screen pixels", true),
			parameter("y", "integer", "Y coordinate in screen pixels", true),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_long_press",
		remoteName: "long_press",
		policy: WRITE_UNSAFE,
		description: "Long press a point on the Android screen through Operit.",
		parameters: [
			parameter("x", "integer", "X coordinate in screen pixels", true),
			parameter("y", "integer", "Y coordinate in screen pixels", true),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_swipe",
		remoteName: "swipe",
		policy: WRITE_UNSAFE,
		description:
			"Swipe from one Android screen coordinate to another through Operit.",
		parameters: [
			parameter(
				"start_x",
				"integer",
				"Start X coordinate in screen pixels",
				true,
			),
			parameter(
				"start_y",
				"integer",
				"Start Y coordinate in screen pixels",
				true,
			),
			parameter("end_x", "integer", "End X coordinate in screen pixels", true),
			parameter("end_y", "integer", "End Y coordinate in screen pixels", true),
			parameter(
				"duration",
				"integer",
				"Optional duration in milliseconds; defaults to 300",
			),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_click_element",
		remoteName: "click_element",
		policy: WRITE_UNSAFE,
		description:
			"Click an Android UI element by resource id, class name, content description, or bounds through Operit.",
		parameters: [
			parameter(
				"resourceId",
				"string",
				"Optional Android resource id selector",
			),
			parameter("className", "string", "Optional Android class name selector"),
			parameter(
				"contentDesc",
				"string",
				"Optional content description selector",
			),
			parameter(
				"bounds",
				"string",
				"Optional bounds selector formatted as [left,top][right,bottom]",
			),
			parameter("partialMatch", "boolean", "Enable partial selector matching"),
			parameter("index", "integer", "Matched element index; defaults to 0"),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_set_input_text",
		remoteName: "set_input_text",
		policy: WRITE_UNSAFE,
		description:
			"Set text into the currently focused Android input field through Operit.",
		parameters: [
			parameter(
				"text",
				"string",
				"Text to enter; an empty string clears the focused field",
				true,
			),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_press_key",
		remoteName: "press_key",
		policy: WRITE_UNSAFE,
		description:
			"Press an Android key code through Operit, for example KEYCODE_BACK.",
		parameters: [
			parameter(
				"key_code",
				"string",
				"Android key code such as KEYCODE_BACK or KEYCODE_HOME",
				true,
			),
			parameter(
				"display",
				"string",
				"Optional display id for multi-display devices",
			),
		],
	},
	{
		localName: "android_sleep",
		remoteName: "sleep",
		policy: READ_DEVICE_STATE,
		description: "Pause briefly on the Android runtime.",
		parameters: [
			parameter(
				"duration_ms",
				"integer",
				"Duration in milliseconds; defaults to 1000 and must be non-negative",
			),
		],
	},
	{
		localName: "android_use_package",
		remoteName: "use_package",
		policy: WRITE_KEYED,
		description:
			"Activate an Operit dynamic package for this Android runtime session.",
		parameters: [
			parameter(
				"package_name",
				"string",
				"Operit package name to activate",
				true,
			),
		],
	},
	{
		localName: "android_list_files",
		remoteName: "list_files",
		policy: READ_PARALLEL,
		description:
			"List files in an Android, Linux, or repository path through Operit.",
		parameters: [
			parameter(
				"path",
				"string",
				"Directory path, for example /sdcard/Download",
				true,
			),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
		],
	},
	{
		localName: "android_read_file",
		remoteName: "read_file",
		policy: READ_PARALLEL,
		description:
			"Read a file through Operit; image files may be OCR-extracted by Operit.",
		parameters: [
			parameter("path", "string", "File path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter(
				"intent",
				"string",
				"Optional question about the media or file",
			),
			parameter(
				"direct_image",
				"boolean",
				"Return an image link for vision-capable models",
			),
			parameter(
				"direct_audio",
				"boolean",
				"Return an audio link for audio-capable models",
			),
			parameter(
				"direct_video",
				"boolean",
				"Return a video link for video-capable models",
			),
		],
	},
	{
		localName: "android_read_file_part",
		remoteName: "read_file_part",
		policy: READ_PARALLEL,
		description: "Read an inclusive line range from a file through Operit.",
		parameters: [
			parameter("path", "string", "File path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter("start_line", "integer", "Starting line number, one-indexed"),
			parameter(
				"end_line",
				"integer",
				"Ending line number, one-indexed and inclusive",
			),
		],
	},
	{
		localName: "android_apply_file",
		remoteName: "apply_file",
		policy: WRITE_KEYED,
		description:
			"Apply a create, replace, or delete style file operation through Operit.",
		parameters: [
			parameter("path", "string", "File path", true),
			parameter(
				"type",
				"string",
				"Operation type expected by Operit, such as create, replace, or delete",
			),
			parameter("old", "string", "Exact old text for a replacement"),
			parameter("new", "string", "Replacement text or complete file content"),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
		],
	},
	{
		localName: "android_create_file",
		remoteName: "create_file",
		policy: WRITE_KEYED,
		description: "Create a file through Operit.",
		parameters: [
			parameter("path", "string", "File path", true),
			parameter("new", "string", "Complete file content", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
		],
	},
	{
		localName: "android_edit_file",
		remoteName: "edit_file",
		policy: WRITE_KEYED,
		description: "Edit a file by exact text replacement through Operit.",
		parameters: [
			parameter("path", "string", "File path", true),
			parameter("old", "string", "Exact content to match", true),
			parameter("new", "string", "Replacement content", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
		],
	},
	{
		localName: "android_delete_file",
		remoteName: "delete_file",
		policy: WRITE_UNSAFE,
		description: "Delete a file or directory through Operit.",
		parameters: [
			parameter("path", "string", "Target path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter("recursive", "boolean", "Delete directories recursively"),
		],
	},
	{
		localName: "android_make_directory",
		remoteName: "make_directory",
		policy: WRITE_KEYED,
		description: "Create a directory through Operit.",
		parameters: [
			parameter("path", "string", "Directory path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter(
				"create_parents",
				"boolean",
				"Create missing parent directories",
			),
		],
	},
	{
		localName: "android_find_files",
		remoteName: "find_files",
		policy: READ_PARALLEL,
		description: "Find files matching a pattern through Operit.",
		parameters: [
			parameter("path", "string", "Search path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter("pattern", "string", "File pattern, for example *.jpg", true),
			parameter(
				"max_depth",
				"integer",
				"Subdirectory search depth; -1 means unlimited",
			),
			parameter(
				"use_path_pattern",
				"boolean",
				"Treat pattern as a path pattern",
			),
			parameter(
				"case_insensitive",
				"boolean",
				"Enable case-insensitive matching",
			),
		],
	},
	{
		localName: "android_grep_code",
		remoteName: "grep_code",
		policy: READ_PARALLEL,
		description: "Search code with a regular expression through Operit.",
		parameters: [
			parameter("path", "string", "Search path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter("pattern", "string", "Regular expression", true),
			parameter("file_pattern", "string", "Optional file filter"),
			parameter(
				"case_insensitive",
				"boolean",
				"Enable case-insensitive matching",
			),
			parameter("context_lines", "integer", "Context lines around each match"),
			parameter("max_results", "integer", "Maximum number of matches"),
		],
	},
	{
		localName: "android_grep_context",
		remoteName: "grep_context",
		policy: READ_PARALLEL,
		description:
			"Search relevant files or code segments by intent through Operit.",
		parameters: [
			parameter("path", "string", "Directory or file path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter("intent", "string", "Intent or context description", true),
			parameter(
				"file_pattern",
				"string",
				"Optional file filter for directory mode",
			),
			parameter("max_results", "integer", "Maximum number of returned items"),
		],
	},
	{
		localName: "android_visit_web",
		remoteName: "visit_web",
		policy: EXTERNAL_READ,
		description:
			"Visit a webpage and extract readable information through Operit.",
		parameters: [
			parameter("url", "string", "Webpage URL"),
			parameter(
				"visit_key",
				"string",
				"visitKey from a previous visit_web result",
			),
			parameter(
				"link_number",
				"integer",
				"One-based link index from previous results",
			),
			parameter(
				"include_image_links",
				"boolean",
				"Include extracted image links",
			),
			parameter(
				"headers",
				"string",
				"Optional HTTP headers encoded as a JSON object string",
			),
			parameter(
				"user_agent_preset",
				"string",
				"User-agent preset: desktop or android",
			),
			parameter("user_agent", "string", "Custom user-agent string"),
		],
	},
	{
		localName: "android_download_file",
		remoteName: "download_file",
		policy: EXTERNAL_WRITE,
		description: "Download a file through Operit.",
		parameters: [
			parameter("url", "string", "File URL"),
			parameter(
				"visit_key",
				"string",
				"visitKey from a previous visit_web result",
			),
			parameter(
				"link_number",
				"integer",
				"One-based link index from previous results",
			),
			parameter(
				"image_number",
				"integer",
				"One-based image index from previous images",
			),
			parameter("destination", "string", "Save path", true),
			parameter(
				"environment",
				"string",
				"Optional environment: android, linux, or repo:<repositoryName>",
			),
			parameter(
				"headers",
				"string",
				"Optional HTTP headers encoded as a JSON object string",
			),
		],
	},
	{
		localName: "android_query_memory",
		remoteName: "query_memory",
		policy: READ_PARALLEL,
		description: "Search the Operit memory library.",
		parameters: [
			parameter(
				"query",
				"string",
				"Natural-language query or keyword expression",
				true,
			),
			parameter("folder_path", "string", "Folder path to search within"),
			parameter(
				"start_time",
				"string",
				"Local time in YYYY-MM-DD or YYYY-MM-DD HH:mm format",
			),
			parameter(
				"end_time",
				"string",
				"Local time in YYYY-MM-DD or YYYY-MM-DD HH:mm format",
			),
			parameter("snapshot_id", "string", "Snapshot id to reuse across queries"),
			parameter("threshold", "number", "Minimum relevance score"),
			parameter("limit", "integer", "Maximum number of results"),
		],
	},
	{
		localName: "android_get_memory_by_title",
		remoteName: "get_memory_by_title",
		policy: READ_PARALLEL,
		description: "Read an Operit memory by exact title.",
		parameters: [
			parameter("title", "string", "Exact memory title", true),
			parameter("chunk_index", "integer", "Specific chunk number"),
			parameter("chunk_range", "string", "Chunk range such as 3-7"),
			parameter("query", "string", "Search inside the document"),
			parameter("limit", "integer", "Maximum chunks when using query"),
		],
	},
];

export const OPERIT_TOOL_SPECS: OperitToolSpec[] =
	OPERIT_TOOL_SPEC_DEFINITIONS.map((spec) => ({
		...spec,
		permission: { describe: (input) => describePermission(spec.localName, input) },
	}));

function describePermission(
	toolName: string,
	input: Record<string, unknown>,
): string {
	switch (toolName) {
		case "android_list_installed_apps":
			return "Read the list of installed third-party Android apps.";
		case "android_start_app":
			return `Launch Android app ${formatValue(input.package_name)}.`;
		case "android_capture_screenshot":
			return "Capture the current Android screen.";
		case "android_get_page_info":
			return `Read current Android page information (${formatFields(input, ["format", "detail", "display"])}).`;
		case "android_tap":
		case "android_long_press":
			return `${toolName === "android_tap" ? "Tap" : "Long press"} ${formatFields(input, ["x", "y", "display"])}.`;
		case "android_swipe":
			return `Swipe ${formatFields(input, ["start_x", "start_y", "end_x", "end_y", "duration", "display"])}.`;
		case "android_click_element":
			return `Click an Android UI element (${formatFields(input, ["resourceId", "className", "contentDesc", "bounds", "index", "display"])}).`;
		case "android_set_input_text":
			return `Enter text into the focused Android field (${textLength(input.text)} characters; text hidden).`;
		case "android_press_key":
			return `Send Android key ${formatValue(input.key_code)}.`;
		case "android_sleep":
			return `Wait ${formatValue(input.duration_ms)} milliseconds on Android.`;
		case "android_use_package":
			return `Activate Operit package ${formatValue(input.package_name)}.`;
		case "android_list_files":
			return `List files at ${formatFields(input, ["path", "environment"])}.`;
		case "android_read_file":
			return `Read file ${formatFields(input, ["path", "environment"])}; file content is hidden.`;
		case "android_read_file_part":
			return `Read file range ${formatFields(input, ["path", "start_line", "end_line", "environment"])}; file content is hidden.`;
		case "android_apply_file":
			return `Apply a file operation at ${formatFields(input, ["path", "type", "environment"])}; content is hidden.`;
		case "android_create_file":
			return `Create file ${formatFields(input, ["path", "environment"])}; content is hidden.`;
		case "android_edit_file":
			return `Edit file ${formatFields(input, ["path", "environment"])}; content is hidden.`;
		case "android_delete_file":
			return `Delete ${formatFields(input, ["path", "environment", "recursive"])}.`;
		case "android_make_directory":
			return `Create directory ${formatFields(input, ["path", "environment", "create_parents"])}.`;
		case "android_find_files":
			return `Find files at ${formatFields(input, ["path", "environment", "pattern", "max_depth"])}.`;
		case "android_grep_code":
			return `Search code at ${formatFields(input, ["path", "environment", "file_pattern", "max_results"])}; pattern is hidden.`;
		case "android_grep_context":
			return `Search code context at ${formatFields(input, ["path", "environment", "file_pattern", "max_results"])}; intent is hidden.`;
		case "android_visit_web":
			return `Visit ${formatUrl(input.url)}.`;
		case "android_download_file":
			return `Download from ${formatUrl(input.url)} to ${formatValue(input.destination)}.`;
		case "android_query_memory":
			return `Query Operit memory (${textLength(input.query)} characters; query hidden).`;
		case "android_get_memory_by_title":
			return `Read Operit memory ${formatValue(input.title)}.`;
		default:
			return `Execute Android tool ${toolName}.`;
	}
}

function formatFields(input: Record<string, unknown>, names: string[]): string {
	const fields = names
		.filter((name) => input[name] !== undefined)
		.map((name) => `${name}=${formatValue(input[name])}`);
	return fields.length > 0 ? fields.join(", ") : "default parameters";
}

function formatValue(value: unknown): string {
	if (typeof value === "string") return truncate(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "unspecified";
}

function textLength(value: unknown): number {
	return typeof value === "string" ? value.length : 0;
}

function formatUrl(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) return "a previous Operit visit";
	try {
		const url = new URL(value);
		return truncate(`${url.protocol}//${url.host}${url.pathname}`);
	} catch {
		return "a requested URL";
	}
}

function truncate(value: string): string {
	const maximumLength = 120;
	return value.length <= maximumLength
		? value
		: `${value.slice(0, maximumLength - 1)}…`;
}
