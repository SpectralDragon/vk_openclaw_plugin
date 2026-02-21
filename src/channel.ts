import {
  type ChannelDock,
  type ChannelPlugin,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk";
import type { VkAccountConfig, VkResolvedAccount } from "./types.js";
import { vkOutbound } from "./outbound.js";

export const vkDock: ChannelDock = {
  id: "vk",
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: true,
    threads: false,
    blockStreaming: false,
  },
  outbound: {
    textChunkLimit: 4096,
  },
};

export const vkPlugin: ChannelPlugin<VkResolvedAccount> = {
  id: "vk",
  meta: {
    id: "vk",
    label: "VK",
    selectionLabel: "VK",
    detailLabel: "VK Bot",
    docsPath: "/channels/vk",
    docsLabel: "vk",
    blurb: "VK Long Polling API integration for OpenClaw.",
    systemImage: "message",
    aliases: ["vkontakte", "вк", "vk.com"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    polls: true,
    threads: false,
    media: true,
    reactions: false,
    edit: false,
    reply: true,
  },

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (_cfg, accountId) => {
      const config = createAccountFromEnv();

      if (!config?.accessToken || !config?.groupId) {
        return {
          accountId: accountId?.trim() || DEFAULT_ACCOUNT_ID,
          enabled: false,
          configured: false,
          config: {
            accessToken: "",
            groupId: 0,
            apiVersion: "5.199",
            longPollWait: 25,
          },
          groupId: 0,
        };
      }

      return {
        accountId: accountId?.trim() || DEFAULT_ACCOUNT_ID,
        enabled: true,
        configured: true,
        config,
        groupId: config.groupId,
      };
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  },

  outbound: vkOutbound,
};

export function createAccountFromEnv(): VkAccountConfig | null {
  const accessToken = process.env.VK_ACCESS_TOKEN;
  const groupIdStr = process.env.VK_GROUP_ID;
  const waitStr = process.env.VK_LONGPOLL_WAIT;
  const apiVersion = process.env.VK_API_VERSION || "5.199";

  if (!accessToken || !groupIdStr) {
    return null;
  }

  const groupId = parseInt(groupIdStr, 10);
  if (Number.isNaN(groupId)) {
    console.error("[VK] Invalid VK_GROUP_ID: must be a number");
    return null;
  }

  const parsedWait = waitStr ? parseInt(waitStr, 10) : 25;
  if (Number.isNaN(parsedWait)) {
    console.error("[VK] Invalid VK_LONGPOLL_WAIT: must be a number from 1 to 25");
    return null;
  }
  const longPollWait = Math.max(1, Math.min(25, parsedWait));

  return {
    accessToken,
    groupId,
    apiVersion,
    longPollWait,
    allowlistUserIds: parseAllowList(process.env.VK_ALLOWLIST_USER_IDS),
    allowlistChatIds: parseAllowList(process.env.VK_ALLOWLIST_CHAT_IDS),
  };
}

function parseAllowList(value?: string): number[] | undefined {
  if (!value?.trim()) return undefined;
  const ids = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => parseInt(v, 10))
    .filter((v) => !Number.isNaN(v));

  return ids.length ? ids : undefined;
}
