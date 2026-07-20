import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import { callOperitTool, getOperitHealth, loadOperitConfig } from "./client.ts";
import { executeWithTransportRetry } from "./execution-policy.ts";
import type { JsonValue, OperitRemoteToolRequest } from "./protocol.ts";
import { createAgentToolResult, isOperitToolDetails } from "./result-mapper.ts";
import { OPERIT_TOOL_SPECS, type OperitParameterSpec } from "./tool-specs.ts";
import { writeOperitTrace } from "./trace-writer.ts";

interface RunTraceState {
	runId: string;
	traceId: string;
	turnIndex: number;
	remainingTransportRetries: number;
}

export default function kooagentOperitExtension(pi: ExtensionAPI) {
	let traceState = createRunTraceState();

	for (const spec of OPERIT_TOOL_SPECS) {
		const parameters = createParametersSchema(spec.parameters);
		const policy = spec.policy;
		pi.registerTool({
			name: spec.localName,
			label: spec.localName,
			description: spec.description,
			promptSnippet: `${spec.localName}: ${spec.description}`,
			promptGuidelines: [
				"Use Android tools only when the task requires the connected Operit device runtime.",
				"Inspect Android state again after UI-changing actions instead of assuming the action succeeded.",
			],
			parameters,
			executionMode: policy.executionMode,
			async execute(toolCallId, params, signal, _onUpdate, ctx) {
				const config = loadOperitConfig();
				const request: OperitRemoteToolRequest = {
					protocolVersion: 2,
					trace: {
						sessionId: ctx.sessionManager.getSessionId(),
						runId: traceState.runId,
						turnIndex: traceState.turnIndex,
						traceId: traceState.traceId,
						toolCallId,
						executionId: randomUUID(),
						attempt: 1,
					},
					toolName: spec.remoteName,
					arguments: params as Record<string, JsonValue>,
					timeoutMs: config.timeoutMs,
				};
				const execution = await executeWithTransportRetry(
					policy,
					async () => await callOperitTool(config, request, signal),
					() => {
						if (traceState.remainingTransportRetries === 0) return false;
						traceState.remainingTransportRetries -= 1;
						return true;
					},
				);
				const outcome = execution.outcome;
				await writeOperitTrace(
					process.env.OPERIT_TRACE_FILE,
					outcome,
					execution.transportAttempts,
				);
				return createAgentToolResult(outcome);
			},
		});
	}

	pi.on("tool_result", (event) => {
		if (!isOperitToolDetails(event.details)) return;
		return {
			isError: event.details.outcome.status !== "SUCCEEDED",
		};
	});

	pi.registerCommand("operit-status", {
		description: "Check the configured Operit Android runtime connection",
		handler: async (_args, ctx) => {
			try {
				const config = loadOperitConfig();
				const health = await getOperitHealth(config);
				ctx.ui.notify(
					`Operit ${health.status} at ${config.baseUrl} (${health.deviceRuntime || "android"})`,
					health.success ? "info" : "warning",
				);
			} catch (error) {
				console.error("Operit status command failed", error);
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus(
			"kooagent-operit",
			`Operit · ${OPERIT_TOOL_SPECS.length} Android tools · protocol v2`,
		);
	});

	pi.on("agent_start", () => {
		traceState = createRunTraceState();
	});

	pi.on("turn_start", (event) => {
		traceState.turnIndex = event.turnIndex;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("kooagent-operit", undefined);
	});
}

function createRunTraceState(): RunTraceState {
	return {
		runId: randomUUID(),
		traceId: randomUUID().replaceAll("-", ""),
		turnIndex: 0,
		remainingTransportRetries: 3,
	};
}

function createParametersSchema(parameters: OperitParameterSpec[]) {
	const properties: Record<string, TSchema> = {};
	for (const parameter of parameters) {
		const schema = createParameterSchema(parameter);
		properties[parameter.name] = parameter.required
			? schema
			: Type.Optional(schema);
	}
	return Type.Object(properties, { additionalProperties: false });
}

function createParameterSchema(parameter: OperitParameterSpec): TSchema {
	const options = { description: parameter.description };
	switch (parameter.kind) {
		case "string":
			return Type.String(options);
		case "integer":
			return Type.Integer(options);
		case "number":
			return Type.Number(options);
		case "boolean":
			return Type.Boolean(options);
	}
}
