import type {
	OperitRemoteContentPart,
	OperitRemoteError,
	OperitRemoteToolOutcome,
} from "./protocol.ts";
import { isOperitRemoteToolOutcome } from "./protocol.ts";

export interface OperitToolDetails {
	kind: "operit-tool-result";
	schemaVersion: 2;
	outcome: OperitRemoteToolOutcome;
	omittedData?: {
		encodedChars: number;
	};
}

export function createAgentToolResult(outcome: OperitRemoteToolOutcome) {
	const encodedData =
		outcome.data === undefined ? undefined : JSON.stringify(outcome.data);
	const omitData =
		encodedData !== undefined && encodedData.length > MAX_DETAILS_DATA_CHARS;
	const detailsOutcome = omitData ? omitOutcomeData(outcome) : outcome;
	const mappedContent = outcome.content.map(mapContentPart);
	return {
		content:
			outcome.status === "SUCCEEDED"
				? mappedContent
				: [createModelErrorSummary(outcome), ...mappedContent],
		details: {
			kind: "operit-tool-result" as const,
			schemaVersion: 2 as const,
			outcome: detailsOutcome,
			...(omitData && encodedData !== undefined
				? { omittedData: { encodedChars: encodedData.length } }
				: {}),
		},
	};
}

function createModelErrorSummary(outcome: OperitRemoteToolOutcome) {
	const error: OperitRemoteError = outcome.error ?? {
		code: "REMOTE_ERROR_UNSPECIFIED",
		category: "INTERNAL",
		message: `Remote tool returned ${outcome.status} without structured error details`,
		retryable: false,
		userActionRequired: false,
	};
	const lines = [
		"[OPERIT_TOOL_ERROR]",
		`status=${outcome.status}`,
		`code=${error.code}`,
		`category=${error.category}`,
		`retryable=${error.retryable}`,
		`userActionRequired=${error.userActionRequired}`,
		`message=${JSON.stringify(boundModelErrorMessage(error.message))}`,
	];
	return { type: "text" as const, text: lines.join("\n") };
}

function boundModelErrorMessage(message: string): string {
	if (message.length <= MAX_MODEL_ERROR_MESSAGE_CHARS) return message;
	return `${message.slice(0, MAX_MODEL_ERROR_MESSAGE_CHARS - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

export function isOperitToolDetails(
	details: unknown,
): details is OperitToolDetails {
	return (
		typeof details === "object" &&
		details !== null &&
		"kind" in details &&
		details.kind === "operit-tool-result" &&
		"schemaVersion" in details &&
		details.schemaVersion === 2 &&
		"outcome" in details &&
		isOperitRemoteToolOutcome(details.outcome)
	);
}

function mapContentPart(part: OperitRemoteContentPart) {
	switch (part.type) {
		case "text":
			return part;
		case "image":
			return part;
		case "artifact":
			return {
				type: "text" as const,
				text: `[artifact ${part.artifactId}] ${part.mimeType}, ${part.size} bytes, sha256=${part.sha256}`,
			};
	}
}

function omitOutcomeData(
	outcome: OperitRemoteToolOutcome,
): OperitRemoteToolOutcome {
	const { data: _data, ...summary } = outcome;
	return summary;
}

const MAX_DETAILS_DATA_CHARS = 32_768;
const MAX_MODEL_ERROR_MESSAGE_CHARS = 1_024;
const TRUNCATED_SUFFIX = "… [truncated]";
