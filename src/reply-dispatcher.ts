import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type OpenClawConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import type { VkAccountConfig } from "./types.js";
import { getVkRuntime } from "./runtime.js";
import { getVkBot } from "./vk-client.js";

export type CreateVkReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  accountConfig: VkAccountConfig;
  replyPeerId: number;
};

export function createVkReplyDispatcher(params: CreateVkReplyDispatcherParams) {
  const core = getVkRuntime();
  const { cfg, agentId, accountConfig, replyPeerId } = params;

  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  const typingCallbacks = createTypingCallbacks({
    start: async () => {},
    stop: async () => {},
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "vk",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "vk",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = 4096;
  const chunkMode: "length" | "newline" = "length";
  const tableMode: "off" | "bullets" | "code" = "bullets";

  const bot = getVkBot(accountConfig);

  const { dispatcher, replyOptions, markDispatchIdle } = core.channel.reply.createReplyDispatcherWithTyping({
    responsePrefix: prefixContext.responsePrefix,
    responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
    humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
    onReplyStart: typingCallbacks.onReplyStart,
    deliver: async (payload: ReplyPayload) => {
      params.runtime.log?.(`[VK] deliver: text=${payload.text?.slice(0, 100)}, mediaUrl=${payload.mediaUrl ?? "none"}, mediaUrls=${payload.mediaUrls?.length ?? 0}`);

      const allMediaUrls: string[] = [];
      if (payload.mediaUrl) allMediaUrls.push(payload.mediaUrl);
      if (payload.mediaUrls?.length) allMediaUrls.push(...payload.mediaUrls);

      for (const mediaUrl of allMediaUrls) {
        try {
          await bot.sendMessage(replyPeerId, `📎 ${mediaUrl}`);
        } catch (err) {
          params.runtime.error?.(`[VK] Failed to send media URL: ${String(err)}`);
        }
      }

      const text = payload.text ?? "";
      if (!text.trim()) return;

      const converted = core.channel.text.convertMarkdownTables(text, tableMode);
      const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);

      for (const chunk of chunks) {
        try {
          await bot.sendMessage(replyPeerId, chunk);
        } catch (err) {
          params.runtime.error?.(`[VK] Failed to send text chunk: ${String(err)}`);
        }
      }
    },
    onError: (err, info) => {
      params.runtime.error?.(`[VK] ${info.kind} reply failed: ${String(err)}`);
      typingCallbacks.onIdle?.();
    },
    onIdle: typingCallbacks.onIdle,
  });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
