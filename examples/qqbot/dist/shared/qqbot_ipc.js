"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qqbotIpc = exports.QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL = exports.QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL = exports.QQBOT_SERVICE_STOP_IPC_CHANNEL = exports.QQBOT_SERVICE_START_IPC_CHANNEL = exports.QQBOT_CONFIGURE_IPC_CHANNEL = exports.QQBOT_DASHBOARD_STATUS_IPC_CHANNEL = void 0;
exports.withContext = withContext;
exports.qqbotDashboardStatusViaIpc = qqbotDashboardStatusViaIpc;
exports.qqbotConfigureViaIpc = qqbotConfigureViaIpc;
exports.qqbotServiceStartViaIpc = qqbotServiceStartViaIpc;
exports.qqbotServiceStopViaIpc = qqbotServiceStopViaIpc;
exports.qqbotAutoReplyConfigureViaIpc = qqbotAutoReplyConfigureViaIpc;
exports.qqbotAutoReplyRunOnceViaIpc = qqbotAutoReplyRunOnceViaIpc;
exports.QQBOT_DASHBOARD_STATUS_IPC_CHANNEL = "qqbot.dashboard_status";
exports.QQBOT_CONFIGURE_IPC_CHANNEL = "qqbot.configure";
exports.QQBOT_SERVICE_START_IPC_CHANNEL = "qqbot.service_start";
exports.QQBOT_SERVICE_STOP_IPC_CHANNEL = "qqbot.service_stop";
exports.QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL = "qqbot.auto_reply.configure";
exports.QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL = "qqbot.auto_reply.run_once";
function previewJson(value, maxLength = 800) {
    try {
        const text = JSON.stringify(value);
        if (typeof text !== "string") {
            return "";
        }
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }
    catch (_error) {
        return "[unserializable]";
    }
}
function readFailureMessage(value) {
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
function defineIpc(channel) {
    return {
        channel,
        async invoke(...args) {
            const payload = args.length > 0 ? args[0] : undefined;
            try {
                const result = await ToolPkg.ipc.call(channel, payload);
                const failureMessage = readFailureMessage(result);
                if (failureMessage) {
                    console.error(`[qqbot_ipc] call returned failure: channel=${channel}, error=${failureMessage}, payload=${previewJson(payload)}, result=${previewJson(result)}`);
                }
                return result;
            }
            catch (error) {
                const errorText = error instanceof Error
                    ? error.message || "error"
                    : (typeof error === "string" || error == null ? error || "error" : "error");
                console.error(`[qqbot_ipc] call threw: channel=${channel}, error=${errorText}, payload=${previewJson(payload)}`);
                throw error;
            }
        }
    };
}
function withContext(definitions) {
    const result = {};
    const keys = Object.keys(definitions);
    keys.forEach((key) => {
        result[key] = definitions[key].invoke;
    });
    return result;
}
exports.qqbotIpc = withContext({
    dashboardStatus: defineIpc(exports.QQBOT_DASHBOARD_STATUS_IPC_CHANNEL),
    configure: defineIpc(exports.QQBOT_CONFIGURE_IPC_CHANNEL),
    serviceStart: defineIpc(exports.QQBOT_SERVICE_START_IPC_CHANNEL),
    serviceStop: defineIpc(exports.QQBOT_SERVICE_STOP_IPC_CHANNEL),
    autoReplyConfigure: defineIpc(exports.QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL),
    autoReplyRunOnce: defineIpc(exports.QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL)
});
async function qqbotDashboardStatusViaIpc(params = {}) {
    return await exports.qqbotIpc.dashboardStatus(params);
}
async function qqbotConfigureViaIpc(params = {}) {
    return await exports.qqbotIpc.configure(params);
}
async function qqbotServiceStartViaIpc(params = {}) {
    return await exports.qqbotIpc.serviceStart(params);
}
async function qqbotServiceStopViaIpc(params = {}) {
    return await exports.qqbotIpc.serviceStop(params);
}
async function qqbotAutoReplyConfigureViaIpc(params = {}) {
    return await exports.qqbotIpc.autoReplyConfigure(params);
}
async function qqbotAutoReplyRunOnceViaIpc() {
    return await exports.qqbotIpc.autoReplyRunOnce();
}
