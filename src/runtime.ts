import type { RuntimeEnv } from "openclaw/plugin-sdk";

let vkRuntime: RuntimeEnv | null = null;

export function setVkRuntime(runtime: RuntimeEnv) {
  vkRuntime = runtime;
}

export function getVkRuntime(): RuntimeEnv {
  if (!vkRuntime) {
    throw new Error("[VK] Runtime not initialized");
  }
  return vkRuntime;
}
