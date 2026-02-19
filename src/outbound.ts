import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getVkConfig } from "./monitor.js";
import { getVkBot } from "./vk-client.js";
import { getVkRuntime } from "./runtime.js";

export const vkOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getVkRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4096,
  sendText: async ({ to, text }) => {
    const config = getVkConfig();
    if (!config) {
      throw new Error("VK not configured");
    }

    const bot = getVkBot(config);
    const peerId = normalizePeerId(to);

    await bot.sendMessage(peerId, text);

    return {
      channel: "vk",
      success: true,
      messageId: `${Date.now()}`,
    };
  },
  sendMedia: async ({ to, text, mediaUrl }) => {
    const config = getVkConfig();
    if (!config) {
      throw new Error("VK not configured");
    }

    const bot = getVkBot(config);
    const peerId = normalizePeerId(to);

    if (text?.trim()) {
      await bot.sendMessage(peerId, text);
    }

    if (mediaUrl) {
      await bot.sendMessage(peerId, `📎 ${mediaUrl}`);
    }

    return {
      channel: "vk",
      success: true,
      messageId: `${Date.now()}`,
    };
  },
};

function normalizePeerId(to: string): number {
  const trimmed = to.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  const match = trimmed.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  throw new Error(`[VK] Invalid peer id: ${to}`);
}
