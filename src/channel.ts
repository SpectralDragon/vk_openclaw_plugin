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
    blurb: "VK Callback API integration for OpenClaw.",
    systemImage: "message",
    aliases: ["vkontakte", "вк", "vk.com"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    polls: false,
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

      if (!config?.accessToken || !config?.groupId || !config?.confirmationToken) {
        return {
          accountId: accountId?.trim() || DEFAULT_ACCOUNT_ID,
          enabled: false,
          configured: false,
          config: {
            accessToken: "",
            groupId: 0,
            confirmationToken: "",
            callbackPath: "/vk/callback",
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
  const confirmationToken = process.env.VK_CONFIRMATION_TOKEN;
  const callbackSecret = process.env.VK_CALLBACK_SECRET;

  if (!accessToken || !groupIdStr || !confirmationToken) {
    return null;
  }

  const groupId = parseInt(groupIdStr, 10);
  if (Number.isNaN(groupId)) {
    console.error("[VK] Invalid VK_GROUP_ID: must be a number");
    return null;
  }

  return {
    accessToken,
    groupId,
    confirmationToken,
    callbackSecret: callbackSecret || undefined,
    callbackPath: process.env.VK_CALLBACK_PATH || "/vk/callback",
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
