import type {
  QQBotActionResult,
  QQBotAutoReplyConfigureParams,
  QQBotConfigureParams,
  QQBotDashboardStatusParams,
  QQBotDashboardStatusResult,
  QQBotServiceStartParams,
  QQBotServiceStopParams
} from "./qqbot_common";

export const QQBOT_DASHBOARD_STATUS_IPC_CHANNEL = "qqbot.dashboard_status";
export const QQBOT_CONFIGURE_IPC_CHANNEL = "qqbot.configure";
export const QQBOT_SERVICE_START_IPC_CHANNEL = "qqbot.service_start";
export const QQBOT_SERVICE_STOP_IPC_CHANNEL = "qqbot.service_stop";
export const QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL = "qqbot.auto_reply.configure";
export const QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL = "qqbot.auto_reply.run_once";

type IpcChannelDefinition<TParams, TResult> = {
  channel: string;
  invoke: (...args: undefined extends TParams ? [] | [params: TParams] : [params: TParams]) => Promise<TResult>;
};

type IpcChannelDefinitions = Record<string, IpcChannelDefinition<unknown, unknown>>;

type IpcContext<TDefinitions extends IpcChannelDefinitions> = {
  [TKey in keyof TDefinitions]:
    TDefinitions[TKey] extends IpcChannelDefinition<infer TParams, infer TResult>
      ? (...args: undefined extends TParams ? [] | [params: TParams] : [params: TParams]) => Promise<TResult>
      : never;
};

function previewJson(value: unknown, maxLength = 800): string {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") {
      return "";
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch (_error) {
    return "[unserializable]";
  }
}

function readFailureMessage(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const success = Reflect.get(value, "success");
  if (success !== false) {
    return "";
  }
  const error = Reflect.get(value, "error");
  return typeof error === "string" && error.trim() ? error.trim() : "success=false";
}

function defineIpc<TParams, TResult>(channel: string): IpcChannelDefinition<TParams, TResult> {
  return {
    channel,
    async invoke(...args: undefined extends TParams ? [] | [params: TParams] : [params: TParams]): Promise<TResult> {
      const payload = args.length > 0 ? args[0] : undefined;
      try {
        const result = await ToolPkg.ipc.call<TParams, TResult>(channel, payload as TParams);
        const failureMessage = readFailureMessage(result);
        if (failureMessage) {
          console.error(
            `[qqbot_ipc] call returned failure: channel=${channel}, error=${failureMessage}, payload=${previewJson(payload)}, result=${previewJson(result)}`
          );
        }
        return result;
      } catch (error) {
        const errorText = error instanceof Error
          ? error.message || "error"
          : (typeof error === "string" || error == null ? error || "error" : "error");
        console.error(
          `[qqbot_ipc] call threw: channel=${channel}, error=${errorText}, payload=${previewJson(payload)}`
        );
        throw error;
      }
    }
  };
}

export function withContext<TDefinitions extends IpcChannelDefinitions>(
  definitions: TDefinitions
): IpcContext<TDefinitions> {
  const result: Partial<IpcContext<TDefinitions>> = {};
  const keys = Object.keys(definitions) as Array<keyof TDefinitions>;
  keys.forEach((key) => {
    result[key] = definitions[key].invoke as IpcContext<TDefinitions>[typeof key];
  });
  return result as IpcContext<TDefinitions>;
}

export const qqbotIpc = withContext({
  dashboardStatus: defineIpc<QQBotDashboardStatusParams, QQBotDashboardStatusResult>(
    QQBOT_DASHBOARD_STATUS_IPC_CHANNEL
  ),
  configure: defineIpc<QQBotConfigureParams, QQBotActionResult>(
    QQBOT_CONFIGURE_IPC_CHANNEL
  ),
  serviceStart: defineIpc<QQBotServiceStartParams, QQBotActionResult>(
    QQBOT_SERVICE_START_IPC_CHANNEL
  ),
  serviceStop: defineIpc<QQBotServiceStopParams, QQBotActionResult>(
    QQBOT_SERVICE_STOP_IPC_CHANNEL
  ),
  autoReplyConfigure: defineIpc<QQBotAutoReplyConfigureParams, QQBotActionResult>(
    QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL
  ),
  autoReplyRunOnce: defineIpc<undefined, QQBotActionResult>(
    QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL
  )
});

export async function qqbotDashboardStatusViaIpc(
  params: QQBotDashboardStatusParams = {}
): Promise<QQBotDashboardStatusResult> {
  return await qqbotIpc.dashboardStatus(params);
}

export async function qqbotConfigureViaIpc(params: QQBotConfigureParams = {}): Promise<QQBotActionResult> {
  return await qqbotIpc.configure(params);
}

export async function qqbotServiceStartViaIpc(
  params: QQBotServiceStartParams = {}
): Promise<QQBotActionResult> {
  return await qqbotIpc.serviceStart(params);
}

export async function qqbotServiceStopViaIpc(
  params: QQBotServiceStopParams = {}
): Promise<QQBotActionResult> {
  return await qqbotIpc.serviceStop(params);
}

export async function qqbotAutoReplyConfigureViaIpc(
  params: QQBotAutoReplyConfigureParams = {}
): Promise<QQBotActionResult> {
  return await qqbotIpc.autoReplyConfigure(params);
}

export async function qqbotAutoReplyRunOnceViaIpc(): Promise<QQBotActionResult> {
  return await qqbotIpc.autoReplyRunOnce();
}
