export type VkAccountConfig = {
  accessToken: string;
  groupId: number;
  apiVersion: string;
  longPollWait: number;
  allowlistUserIds?: number[];
  allowlistChatIds?: number[];
};

export type VkResolvedAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  config: VkAccountConfig;
  groupId: number;
};

export type VkInboundAttachment =
  | { kind: "image"; url: string; label?: string }
  | { kind: "file"; url: string; label?: string }
  | { kind: "audio"; url: string; label?: string }
  | { kind: "video"; url: string; label?: string }
  | { kind: "sticker"; url: string; label?: string };
