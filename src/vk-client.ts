import VkBotApi from "node-vk-bot-api";
import type { VkAccountConfig } from "./types.js";

const clients = new Map<string, VkBotApi>();

export function getVkBot(config: VkAccountConfig): VkBotApi {
  const key = `${config.groupId}:${config.accessToken.slice(0, 6)}`;
  let bot = clients.get(key);
  if (!bot) {
    bot = new VkBotApi({
      token: config.accessToken,
      group_id: config.groupId,
    });
    clients.set(key, bot);
  }
  return bot;
}

export function clearVkBotCache() {
  clients.clear();
}
