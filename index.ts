/**
 * VK OpenClaw Integration
 *
 * Connect your OpenClaw AI agent to VK via Long Polling API
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { vkPlugin, vkDock } from "./src/channel.js";
import { setVkRuntime } from "./src/runtime.js";
import { handleVkWebhookRequest } from "./src/monitor.js";
import { startVkLongPolling } from "./src/long-poll.js";

const plugin: {
  id: string;
  name: string;
  description: string;
  configSchema: any;
  register: (api: OpenClawPluginApi) => void;
} = {
  id: "vk-openclaw-plugin",
  name: "VK",
  description: "OpenClaw VK channel plugin",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    setVkRuntime(api.runtime);
    api.registerChannel({ plugin: vkPlugin, dock: vkDock });
    api.registerHttpHandler(handleVkWebhookRequest);
    startVkLongPolling();

    const config = vkPlugin.config.resolveAccount({}, undefined);
    if (!config?.configured) {
      console.warn("[VK] Plugin registered but not configured.");
      console.warn("[VK] Set environment variables: VK_ACCESS_TOKEN, VK_GROUP_ID");
    } else {
      console.log("[VK] Plugin registered");
      console.log(`[VK] Group ID: ${config.groupId}`);
      console.log("[VK] Inbound mode: long polling");
    }
  },
};

export default plugin;

export { vkPlugin, vkDock } from "./src/channel.js";
export { handleVkWebhookRequest } from "./src/monitor.js";
