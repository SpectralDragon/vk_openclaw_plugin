import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { getVkRuntime } from "./runtime.js";
import { createAccountFromEnv } from "./channel.js";
import type { VkAccountConfig, VkInboundAttachment } from "./types.js";
import { createVkReplyDispatcher } from "./reply-dispatcher.js";

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
    res.end(JSON.stringify({ status: "ok", channel: "vk", timestamp: new Date().toISOString() }));
    return true;
  }

  if (!urlStr.startsWith("/vk/callback")) {
    return false;
  }

  try {
    await handleRequest(req, res);
    return true;
  } catch (err) {
    console.error("[VK] Webhook error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
    return true;
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = getVkConfig();
  if (!config) {
    res.writeHead(500);
    res.end("VK not configured");
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  if (config.callbackSecret && body.secret && body.secret !== config.callbackSecret) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (body.group_id && Number(body.group_id) !== config.groupId) {
    res.writeHead(403);
    res.end("Invalid group id");
    return;
  }

  if (body.type === "confirmation") {
    res.writeHead(200);
    res.end(config.confirmationToken);
    return;
  }

  if (body.type === "message_allow" || body.type === "message_deny") {
    const core = getVkRuntime();
    const cfg = await loadConfigFromRuntime(core);
    const runtime = createRuntimeFromCore(core);
    const object = body.object || {};
    const userId = Number(object.user_id || object.userId || object.user);
    const eventLabel = body.type === "message_allow" ? "VK user allowed messages" : "VK user denied messages";
    if (userId) {
      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "vk",
        peer: { kind: "dm", id: String(userId) },
      });
      core.system.enqueueSystemEvent(`${eventLabel}: ${userId}`, {
        sessionKey: route.sessionKey,
        contextKey: `vk:${body.type}:${userId}:${Date.now()}`,
      });
    } else {
      runtime.warn?.(`[VK] ${eventLabel} but user_id missing`);
    }

    res.writeHead(200);
    res.end("ok");
    return;
  }

  const supportedTypes = new Set(["message_new", "message_edit", "message_reply"]);
  if (!supportedTypes.has(body.type)) {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  const message = body.object?.message || body.object?.reply_message || body.object?.reply;
  if (!message) {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  const peerId = Number(message.peer_id);
  const fromId = Number(message.from_id);
  const chatId = peerId >= 2000000000 ? peerId - 2000000000 : undefined;

  if (!isAllowed(config, fromId, chatId)) {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  const attachments = parseAttachments(message.attachments || []);
  const attachmentText = attachments.summary;
  const eventPrefix = body.type === "message_edit"
    ? "[edited] "
    : body.type === "message_reply"
      ? "[reply] "
      : "";
  const content = [eventPrefix + (message.text || ""), attachmentText].filter(Boolean).join("\n").trim();

  if (!content) {
    res.writeHead(200);
    res.end("ok");
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

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `vk:message:${message.conversation_message_id}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const envelopeFrom = isGroup ? `${chatId}:${fromId}` : String(fromId);
    const bodyText = core.channel.reply.formatAgentEnvelope({
      channel: "VK",
      from: envelopeFrom,
      timestamp: new Date(message.date * 1000),
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
      MessageSid: String(message.id || message.conversation_message_id || Date.now()),
      Timestamp: message.date * 1000,
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

  res.writeHead(200);
  res.end("ok");
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

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
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
