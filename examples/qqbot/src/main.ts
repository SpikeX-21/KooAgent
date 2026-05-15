import qqbotSettingsScreen from "./ui/qqbot_settings/index.ui.js";
import {
  onQQBotListenerApplicationCreate as qqbotListenerApplicationCreate,
  onQQBotListenerApplicationForeground as qqbotListenerApplicationForeground
} from "./shared/qqbot_runtime";
import {
  onQQBotAutoReplyApplicationCreate as qqbotAutoReplyApplicationCreate,
  onQQBotAutoReplyApplicationForeground as qqbotAutoReplyApplicationForeground,
  onQQBotAutoReplyApplicationTerminate as qqbotAutoReplyApplicationTerminate,
  qqbot_auto_reply_configure,
  qqbot_auto_reply_run_once
} from "./shared/qqbot_auto_reply";
import {
  qqbot_configure,
  qqbot_dashboard_status,
  qqbot_service_start,
  qqbot_service_stop
} from "./shared/qqbot_runtime";
import {
  QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL,
  QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL,
  QQBOT_CONFIGURE_IPC_CHANNEL,
  QQBOT_DASHBOARD_STATUS_IPC_CHANNEL,
  QQBOT_SERVICE_START_IPC_CHANNEL,
  QQBOT_SERVICE_STOP_IPC_CHANNEL
} from "./shared/qqbot_ipc";

export {
  qqbotListenerApplicationCreate,
  qqbotListenerApplicationForeground,
  qqbotAutoReplyApplicationCreate,
  qqbotAutoReplyApplicationForeground,
  qqbotAutoReplyApplicationTerminate
};

let qqbotIpcRegistered = false;

function logQQBotStartup(message: string): void {
  console.log(`[qqbot] ${message}`);
}

function registerQQBotIpc(): void {
  if (qqbotIpcRegistered) {
    return;
  }
  qqbotIpcRegistered = true;
  ToolPkg.ipc.on(QQBOT_DASHBOARD_STATUS_IPC_CHANNEL, qqbot_dashboard_status);
  ToolPkg.ipc.on(QQBOT_CONFIGURE_IPC_CHANNEL, qqbot_configure);
  ToolPkg.ipc.on(QQBOT_SERVICE_START_IPC_CHANNEL, qqbot_service_start);
  ToolPkg.ipc.on(QQBOT_SERVICE_STOP_IPC_CHANNEL, qqbot_service_stop);
  ToolPkg.ipc.on(QQBOT_AUTO_REPLY_CONFIGURE_IPC_CHANNEL, qqbot_auto_reply_configure);
  ToolPkg.ipc.on(QQBOT_AUTO_REPLY_RUN_ONCE_IPC_CHANNEL, qqbot_auto_reply_run_once);
}

registerQQBotIpc();

export function registerToolPkg() {
  logQQBotStartup("registerToolPkg start");

  ToolPkg.registerToolboxUiModule({
    id: "qqbot_settings",
    runtime: "compose_dsl",
    screen: qqbotSettingsScreen,
    params: {},
    title: {
      zh: "QQ Bot 设置",
      en: "QQ Bot Settings",
    },
  });

  ToolPkg.registerAppLifecycleHook({
    id: "qqbot_listener_app_create",
    event: "application_on_create",
    function: qqbotListenerApplicationCreate,
  });

  ToolPkg.registerAppLifecycleHook({
    id: "qqbot_listener_app_foreground",
    event: "application_on_foreground",
    function: qqbotListenerApplicationForeground,
  });

  ToolPkg.registerAppLifecycleHook({
    id: "qqbot_auto_reply_app_create",
    event: "application_on_create",
    function: qqbotAutoReplyApplicationCreate,
  });

  ToolPkg.registerAppLifecycleHook({
    id: "qqbot_auto_reply_app_foreground",
    event: "application_on_foreground",
    function: qqbotAutoReplyApplicationForeground,
  });

  ToolPkg.registerAppLifecycleHook({
    id: "qqbot_auto_reply_app_terminate",
    event: "application_on_terminate",
    function: qqbotAutoReplyApplicationTerminate,
  });

  logQQBotStartup("registerToolPkg hooks registered");
  logQQBotStartup("registerToolPkg done");

  return true;
}
