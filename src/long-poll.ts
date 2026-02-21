import { setTimeout as sleep } from "node:timers/promises";
import { getVkConfig, processVkUpdate } from "./monitor.js";
import type { VkAccountConfig } from "./types.js";

type LongPollServer = {
  server: string;
  key: string;
  ts: string;
};

type LongPollCheckResult = {
  ts?: string | number;
  updates?: unknown[];
  failed?: number;
};

const LONG_POLL_VERSION = "3";
const RETRY_DELAY_MS = 2000;

let longPollLoopStarted = false;

export function startVkLongPolling(): void {
  if (longPollLoopStarted) {
    return;
  }

  longPollLoopStarted = true;

  void runVkLongPollLoop()
    .catch((err) => {
      console.error("[VK] Long polling stopped due to fatal error:", err);
    })
    .finally(() => {
      longPollLoopStarted = false;
    });
}

async function runVkLongPollLoop(): Promise<void> {
  const config = getVkConfig();
  if (!config) {
    console.warn("[VK] Long polling disabled: set VK_ACCESS_TOKEN and VK_GROUP_ID");
    return;
  }

  console.log(`[VK] Starting long polling for group ${config.groupId}`);

  let server = await requestLongPollServerWithRetry(config);

  while (true) {
    try {
      const result = await checkLongPoll(server, config);

      if (result.failed === 1 && result.ts !== undefined) {
        server.ts = String(result.ts);
        continue;
      }

      if (result.failed === 2 || result.failed === 3) {
        console.warn(`[VK] Long poll state expired (failed=${result.failed}), refreshing server`);
        server = await requestLongPollServerWithRetry(config);
        continue;
      }

      if (result.failed && result.failed !== 0) {
        console.warn(`[VK] Unexpected long poll failure code: ${result.failed}`);
        await sleep(RETRY_DELAY_MS);
        server = await requestLongPollServerWithRetry(config);
        continue;
      }

      if (result.ts !== undefined) {
        server.ts = String(result.ts);
      }

      const updates = Array.isArray(result.updates) ? result.updates : [];
      for (const update of updates) {
        await processVkUpdate(update, config);
      }
    } catch (err) {
      console.error("[VK] Long poll check failed:", err);
      await sleep(RETRY_DELAY_MS);
      server = await requestLongPollServerWithRetry(config);
    }
  }
}

async function requestLongPollServerWithRetry(config: VkAccountConfig): Promise<LongPollServer> {
  while (true) {
    try {
      return await requestLongPollServer(config);
    } catch (err) {
      console.error("[VK] Failed to get long poll server:", err);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function requestLongPollServer(config: VkAccountConfig): Promise<LongPollServer> {
  const methodUrl = new URL("https://api.vk.com/method/groups.getLongPollServer");
  methodUrl.searchParams.set("group_id", String(config.groupId));
  methodUrl.searchParams.set("access_token", config.accessToken);
  methodUrl.searchParams.set("v", config.apiVersion);

  const payload = await fetchJson(methodUrl.toString(), 15_000);
  if (payload?.error) {
    const message = payload.error.error_msg || "Unknown VK API error";
    throw new Error(`[VK] groups.getLongPollServer failed: ${message}`);
  }

  const response = payload?.response;
  if (!response?.server || !response?.key || response?.ts === undefined) {
    throw new Error("[VK] groups.getLongPollServer returned invalid response");
  }

  const serverUrl = String(response.server);
  return {
    server: serverUrl.startsWith("http") ? serverUrl : `https://${serverUrl}`,
    key: String(response.key),
    ts: String(response.ts),
  };
}

async function checkLongPoll(server: LongPollServer, config: VkAccountConfig): Promise<LongPollCheckResult> {
  const pollUrl = new URL(server.server);
  pollUrl.searchParams.set("act", "a_check");
  pollUrl.searchParams.set("key", server.key);
  pollUrl.searchParams.set("ts", server.ts);
  pollUrl.searchParams.set("wait", String(config.longPollWait));
  pollUrl.searchParams.set("mode", "2");
  pollUrl.searchParams.set("version", LONG_POLL_VERSION);

  const timeoutMs = (config.longPollWait + 15) * 1000;
  return fetchJson(pollUrl.toString(), timeoutMs);
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`[VK] HTTP ${response.status} from ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
