import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { createAccountFromEnv } from "./channel.js";
import { createVkReplyDispatcher } from "./reply-dispatcher.js";
import { getVkRuntime } from "./runtime.js";
import type { VkAccountConfig, VkInboundAttachment } from "./types.js";

const supportedTypes = new Set(["message_new", "message_edit", "message_reply"]);

export function getVkConfig(): VkAccountConfig | null {
  return createAccountFromEnv();
}

export async function handleVkWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const urlStr = req.url || "/";

  if (urlStr.startsWith("/vk/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", channel: "vk", mode: "long-poll", timestamp: new Date().toISOString() }));
    return true;
  }

  if (urlStr.startsWith("/vk/callback")) {
    res.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("VK Callback API is disabled. Use Long Polling API.");
    return true;
  }

  return false;
}

export async function processVkUpdate(update: any, accountConfig?: VkAccountConfig): Promise<void> {
  const config = accountConfig ?? getVkConfig();
  if (!config) {
    console.warn("[VK] Skipping inbound update: VK not configured");
    return;
  }

  if (!update || typeof update !== "object") {
    return;
  }

  if (update.group_id && Number(update.group_id) !== config.groupId) {
    return;
  }

  if (update.type === "message_allow" || update.type === "message_deny") {
    await handleAllowDenyUpdate(update);
    return;
  }

  if (!supportedTypes.has(update.type)) {
    return;
  }

  const message = update.object?.message || update.object?.reply_message || update.object?.reply;
  if (!message) {
    return;
  }

  const peerId = Number(message.peer_id);
  const fromId = Number(message.from_id);
  if (!Number.isFinite(peerId) || !Number.isFinite(fromId) || fromId <= 0) {
    return;
  }

  const chatId = peerId >= 2000000000 ? peerId - 2000000000 : undefined;

  if (!isAllowed(config, fromId, chatId)) {
    return;
  }

  const attachments = parseAttachments(message.attachments || []);
  const attachmentText = attachments.summary;
  const eventPrefix = update.type === "message_edit"
    ? "[edited] "
    : update.type === "message_reply"
      ? "[reply] "
      : "";
  const content = [eventPrefix + (message.text || ""), attachmentText].filter(Boolean).join("\n").trim();

  if (!content) {
    return;
  }

  try {
    const core = getVkRuntime();
    const cfg = await loadConfigFromRuntime(core);
    const runtime = createRuntimeFromCore(core);

    const isGroup = !!chatId;
    const peerKind = isGroup ? "group" : "dm";

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "vk",
      peer: {
        kind: peerKind,
        id: isGroup ? String(chatId) : String(fromId),
      },
    });

    const preview = content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `VK message in chat ${chatId}`
      : `VK DM from ${fromId}`;

    const contextMessageId = String(message.id || message.conversation_message_id || Date.now());
    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `vk:message:${contextMessageId}`,
    });

    const timestampSec = Number(message.date);
    const timestampMs = Number.isFinite(timestampSec) && timestampSec > 0
      ? timestampSec * 1000
      : Date.now();

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const envelopeFrom = isGroup ? `${chatId}:${fromId}` : String(fromId);
    const bodyText = core.channel.reply.formatAgentEnvelope({
      channel: "VK",
      from: envelopeFrom,
      timestamp: new Date(timestampMs),
      envelope: envelopeOptions,
      body: `${fromId}: ${content}`,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: bodyText,
      RawBody: message.text || "",
      CommandBody: content,
      From: `vk:${fromId}`,
      To: `vk:${peerId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? `chat:${chatId}` : undefined,
      SenderName: String(fromId),
      SenderId: String(fromId),
      Provider: "vk" as const,
      Surface: "vk" as const,
      MessageSid: contextMessageId,
      Timestamp: timestampMs,
      WasMentioned: false,
      CommandAuthorized: true,
      OriginatingChannel: "vk" as const,
      OriginatingTo: `vk:${peerId}`,
      Media: attachments.media.length ? attachments.media : undefined,
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createVkReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime,
      accountConfig: config,
      replyPeerId: peerId,
    });

    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();
  } catch (err) {
    console.error("[VK] Dispatch failed:", err);
  }
}

async function handleAllowDenyUpdate(update: any): Promise<void> {
  const core = getVkRuntime();
  const cfg = await loadConfigFromRuntime(core);
  const runtime = createRuntimeFromCore(core);
  const object = update.object || {};
  const userId = Number(object.user_id || object.userId || object.user);
  const eventLabel = update.type === "message_allow" ? "VK user allowed messages" : "VK user denied messages";

  if (userId) {
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "vk",
      peer: { kind: "dm", id: String(userId) },
    });
    core.system.enqueueSystemEvent(`${eventLabel}: ${userId}`, {
      sessionKey: route.sessionKey,
      contextKey: `vk:${update.type}:${userId}:${Date.now()}`,
    });
    return;
  }

  runtime.warn?.(`[VK] ${eventLabel} but user_id missing`);
}

function isAllowed(config: VkAccountConfig, fromId: number, chatId?: number): boolean {
  const userAllowlist = config.allowlistUserIds;
  const chatAllowlist = config.allowlistChatIds;

  if (userAllowlist?.length && !userAllowlist.includes(fromId)) {
    return false;
  }

  if (chatId && chatAllowlist?.length && !chatAllowlist.includes(chatId)) {
    return false;
  }

  return true;
}

function parseAttachments(attachments: any[]): { summary: string; media: VkInboundAttachment[] } {
  const media: VkInboundAttachment[] = [];
  const labels: string[] = [];

  for (const item of attachments) {
    if (!item?.type) continue;

    switch (item.type) {
      case "photo": {
        const photo = item.photo;
        const sizes = photo?.sizes || [];
        const best = sizes.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0];
        if (best?.url) {
          media.push({ kind: "image", url: best.url, label: "photo" });
          labels.push("[photo]");
        }
        break;
      }
      case "doc": {
        const doc = item.doc;
        if (doc?.url) {
          media.push({ kind: "file", url: doc.url, label: doc.title || "doc" });
          labels.push(`[doc: ${doc.title || "file"}]`);
        }
        break;
      }
      case "audio": {
        const audio = item.audio;
        labels.push(`[audio: ${audio?.artist || ""} ${audio?.title || ""}]`.trim());
        break;
      }
      case "video": {
        const video = item.video;
        labels.push(`[video: ${video?.title || "video"}]`);
        break;
      }
      case "sticker": {
        const sticker = item.sticker;
        const url = sticker?.images?.[sticker.images.length - 1]?.url;
        if (url) {
          media.push({ kind: "sticker", url, label: "sticker" });
        }
        labels.push("[sticker]");
        break;
      }
      case "audio_message": {
        const audioMessage = item.audio_message;
        if (audioMessage?.link_mp3) {
          media.push({ kind: "audio", url: audioMessage.link_mp3, label: "voice" });
          labels.push("[voice message]");
        }
        break;
      }
      default:
        labels.push(`[${item.type}]`);
        break;
    }
  }

  return {
    summary: labels.length ? labels.join(" ") : "",
    media,
  };
}

async function loadConfigFromRuntime(core: any): Promise<OpenClawConfig> {
  if (core?.config?.get) {
    try {
      return await core.config.get();
    } catch (err) {
      console.warn("[VK] Failed to load config from runtime via config.get():", err);
    }
  }

  if (core?.config?.loadConfig) {
    try {
      return core.config.loadConfig();
    } catch (err) {
      console.warn("[VK] Failed to load config from runtime via config.loadConfig():", err);
    }
  }

  if (core?.cfg) {
    return core.cfg;
  }

  const config: OpenClawConfig = {
    env: {},
    agents: {
      defaults: {
        model: {
          primary: process.env.OPENROUTER_API_KEY
            ? "openrouter/qwen/qwen3-max"
            : process.env.OPENAI_API_KEY
              ? "openai/gpt-4o"
              : "anthropic/claude-sonnet-4-5-20251101",
        },
      },
    },
    gateway: {
      mode: "local",
      bind: "lan",
      port: 18789,
    },
  } as OpenClawConfig;

  return config;
}

function createRuntimeFromCore(core: any): RuntimeEnv {
  if (core?.log && core?.error && core?.channel) {
    return core as RuntimeEnv;
  }

  return {
    log: core?.log ?? console.log,
    error: core?.error ?? console.error,
    warn: core?.warn ?? console.warn,
    debug: core?.debug ?? console.debug,
    channel: core?.channel,
    config: core?.config,
    system: core?.system,
  } as RuntimeEnv;
}
