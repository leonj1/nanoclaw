import type { NormalizedMessage } from '../channels/types.js';

export type TelegramMode = 'polling' | 'webhook';

export type TelegramDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';

export type TelegramGroupPolicy = 'open' | 'allowlist' | 'disabled';

export type TelegramReplyToMode = 'first' | 'all' | 'none';

export type TelegramAllowlistType = 'id' | 'username' | 'wildcard';

export interface RetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface TelegramPairingEntry {
  code: string;
  chatId: string;
  userId: string;
  username?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AllowlistEntry {
  type: TelegramAllowlistType;
  value: string;
}

export interface TelegramChannelConfig {
  botToken?: string;
  tokenFile?: string;
  mode?: TelegramMode;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPort?: number;
  dmPolicy?: TelegramDmPolicy;
  allowFrom?: string[];
  groupPolicy?: TelegramGroupPolicy;
  groupAllowFrom?: string[];
  requireMention?: boolean;
  mentionKeywords?: string[];
  mediaMaxMb?: number;
  replyToMode?: TelegramReplyToMode;
  linkPreview?: boolean;
  retry?: RetryConfig;
  runner?: {
    concurrency?: number;
  };
  rateLimit?: {
    maxRequestsPerSecond?: number;
    maxBurst?: number;
  };
}

export interface TelegramMessageTarget {
  chatId: string;
  threadId?: number;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

export interface AccessContext {
  botUsername?: string;
}

export type AccessEvaluator = (
  message: NormalizedMessage,
  context?: AccessContext,
) => AccessDecision;
