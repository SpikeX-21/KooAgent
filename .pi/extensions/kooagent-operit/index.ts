import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import {
	callOperitTool,
	getOperitHealth,
	loadOperitConfig,
	type OperitToolCallResponse,
} from "./client.ts";
import { OPERIT_TOOL_SPECS, type OperitParameterSpec } from "./tool-specs.ts";

interface OperitToolDetails {
	requestId?: string;
	toolName: string;
	latencyMs: number;
	resultJson?: string;
	response: OperitToolCallResponse;
}

export default function kooagentOperitExtension(pi: ExtensionAPI) {
	for (const spec of OPERIT_TOOL_SPECS) {
		const parameters = createParametersSchema(spec.parameters);
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
			executionMode: "sequential",
			async execute(toolCallId, params, signal) {
				const response = await callOperitTool(
					loadOperitConfig(),
					{
						requestId: toolCallId,
						toolName: spec.remoteName,
						arguments: params as Record<string, unknown>,
					},
					signal,
				);

				const details: OperitToolDetails = {
					requestId: response.requestId,
					toolName: response.toolName,
					latencyMs: response.latencyMs,
					resultJson: response.resultJson,
					response,
				};
				return {
					content: [
						{
							type: "text",
							text:
								response.resultText ||
								`${response.toolName} completed successfully`,
						},
					],
					details,
				};
			},
		});
	}

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
			`Operit · ${OPERIT_TOOL_SPECS.length} Android tools`,
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("kooagent-operit", undefined);
	});
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
