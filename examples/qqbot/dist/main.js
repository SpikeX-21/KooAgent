"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.qqbotAutoReplyApplicationTerminate = exports.qqbotAutoReplyApplicationForeground = exports.qqbotAutoReplyApplicationCreate = exports.qqbotListenerApplicationForeground = exports.qqbotListenerApplicationCreate = void 0;
exports.registerToolPkg = registerToolPkg;
const index_ui_js_1 = __importDefault(require("./ui/qqbot_settings/index.ui.js"));
const qqbot_runtime_1 = require("./shared/qqbot_runtime");
Object.defineProperty(exports, "qqbotListenerApplicationCreate", { enumerable: true, get: function () { return qqbot_runtime_1.onQQBotListenerApplicationCreate; } });
Object.defineProperty(exports, "qqbotListenerApplicationForeground", { enumerable: true, get: function () { return qqbot_runtime_1.onQQBotListenerApplicationForeground; } });
const qqbot_auto_reply_1 = require("./shared/qqbot_auto_reply");
Object.defineProperty(exports, "qqbotAutoReplyApplicationCreate", { enumerable: true, get: function () { return qqbot_auto_reply_1.onQQBotAutoReplyApplicationCreate; } });
Object.defineProperty(exports, "qqbotAutoReplyApplicationForeground", { enumerable: true, get: function () { return qqbot_auto_reply_1.onQQBotAutoReplyApplicationForeground; } });
Object.defineProperty(exports, "qqbotAutoReplyApplicationTerminate", { enumerable: true, get: function () { return qqbot_auto_reply_1.onQQBotAutoReplyApplicationTerminate; } });
const qqbot_runtime_2 = require("./shared/qqbot_runtime");
const qqbot_ipc_1 = require("./shared/qqbot_ipc");
let qqbotIpcRegistered = false;
function logQQBotStartup(message) {
    console.log(`[qqbot] ${message}`);
}
function registerQQBotIpc() {
    if (qqbotIpcRegistered) {
        return;
    }
    qqbotIpcRegistered = true;
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_DASHBOARD_STATUS_IPC_CHANNEL, qqbot_runtime_2.qqbot_dashboard_status);
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_CONFIGURE_IPC_CHANNEL, qqbot_runtime_2.qqbot_configure);
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_SERVICE_START_IPC_CHANNEL, qqbot_runtime_2.qqbot_service_start);
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_SERVICE_STOP_IPC_CHANNEL, qqbot_runtime_2.qqbot_service_stop);
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL, qqbot_auto_reply_1.qqbot_auto_reply_configure);
    ToolPkg.ipc.on(qqbot_ipc_1.QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL, qqbot_auto_reply_1.qqbot_auto_reply_run_once);
}
registerQQBotIpc();
function registerToolPkg() {
    logQQBotStartup("registerToolPkg start");
    ToolPkg.registerToolboxUiModule({
        id: "qqbot_settings",
        runtime: "compose_dsl",
        screen: index_ui_js_1.default,
        params: {},
        title: {
            zh: "QQ Bot 设置",
            en: "QQ Bot Settings",
        },
    });
    ToolPkg.registerAppLifecycleHook({
        id: "qqbot_listener_app_create",
        event: "application_on_create",
        function: qqbot_runtime_1.onQQBotListenerApplicationCreate,
    });
    ToolPkg.registerAppLifecycleHook({
        id: "qqbot_listener_app_foreground",
        event: "application_on_foreground",
        function: qqbot_runtime_1.onQQBotListenerApplicationForeground,
    });
    ToolPkg.registerAppLifecycleHook({
        id: "qqbot_auto_reply_app_create",
        event: "application_on_create",
        function: qqbot_auto_reply_1.onQQBotAutoReplyApplicationCreate,
    });
    ToolPkg.registerAppLifecycleHook({
        id: "qqbot_auto_reply_app_foreground",
        event: "application_on_foreground",
        function: qqbot_auto_reply_1.onQQBotAutoReplyApplicationForeground,
    });
    ToolPkg.registerAppLifecycleHook({
        id: "qqbot_auto_reply_app_terminate",
        event: "application_on_terminate",
        function: qqbot_auto_reply_1.onQQBotAutoReplyApplicationTerminate,
    });
    logQQBotStartup("registerToolPkg hooks registered");
    logQQBotStartup("registerToolPkg done");
    return true;
}
