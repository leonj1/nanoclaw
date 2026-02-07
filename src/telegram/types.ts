import type { NormalizedMessage } from '../channels/types.js';

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export type TelegramDmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';
export type TelegramGroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface TelegramChannelConfig {
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  allowFrom?: string[];
  groupAllowFrom?: string[];
  dmPolicy?: TelegramDmPolicy;
  groupPolicy?: TelegramGroupPolicy;
  requireMention?: boolean;
  mentionKeywords?: string[];
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
