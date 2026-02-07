import type { NormalizedMessage } from '../channels/types.js';
import type { AccessDecision, TelegramChannelConfig } from './types.js';

const WILDCARD = '*';

function normalizeValue(value?: string): string | undefined {
  return value ? value.toLowerCase() : undefined;
}

export class TelegramAccessController {
  private readonly dmPolicy;
  private readonly groupPolicy;
  private readonly dmAllowlist;
  private readonly groupAllowlist;
  private readonly requireMention;
  private readonly mentionKeywords;
  private botUsername?: string;

  constructor(config: TelegramChannelConfig) {
    this.dmPolicy = config.dmPolicy ?? 'open';
    this.groupPolicy = config.groupPolicy ?? 'open';
    this.dmAllowlist = (config.allowFrom ?? []).map((entry) => entry.toLowerCase());
    this.groupAllowlist = (config.groupAllowFrom ?? []).map((entry) =>
      entry.toLowerCase(),
    );
    this.requireMention = config.requireMention ?? false;
    this.mentionKeywords = (config.mentionKeywords ?? []).map((keyword) =>
      keyword.toLowerCase(),
    );
  }

  setBotUsername(username?: string): void {
    this.botUsername = username?.toLowerCase();
  }

  evaluate(message: NormalizedMessage): AccessDecision {
    if (message.chatType === 'private') {
      return this.evaluateDm(message);
    }
    return this.evaluateGroup(message);
  }

  private evaluateDm(message: NormalizedMessage): AccessDecision {
    if (this.dmPolicy === 'disabled') {
      return { allowed: false, reason: 'DMs disabled' };
    }

    if (
      this.dmPolicy === 'allowlist' ||
      this.dmPolicy === 'pairing'
    ) {
      if (this.matchesAllowlist(this.dmAllowlist, message.senderId, message.senderUsername)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Sender not in DM allowlist' };
    }

    return { allowed: true };
  }

  private evaluateGroup(message: NormalizedMessage): AccessDecision {
    if (this.groupPolicy === 'disabled') {
      return { allowed: false, reason: 'Group messages disabled' };
    }

    if (this.groupPolicy === 'allowlist') {
      if (!this.matchesAllowlist(this.groupAllowlist, message.chatId)) {
        return { allowed: false, reason: 'Group not in allowlist' };
      }
    }

    if (this.requireMention && !this.wasBotMentioned(message)) {
      return { allowed: false, reason: 'Missing mention' };
    }

    return { allowed: true };
  }

  private matchesAllowlist(
    allowlist: string[],
    primary?: string,
    secondary?: string,
  ): boolean {
    if (!allowlist.length) {
      return false;
    }

    const normalizedPrimary = normalizeValue(primary);
    const normalizedSecondary = normalizeValue(secondary);

    return allowlist.some((entry) => {
      if (entry === WILDCARD) return true;
      return (
        (normalizedPrimary && entry === normalizedPrimary) ||
        (normalizedSecondary && entry === normalizedSecondary)
      );
    });
  }

  private wasBotMentioned(message: NormalizedMessage): boolean {
    if (!message.mentions.length) {
      return false;
    }
    const lowerMentions = message.mentions.map((mention) => mention.toLowerCase());
    if (this.botUsername && lowerMentions.includes(this.botUsername)) {
      return true;
    }
    return this.mentionKeywords.some((keyword) => lowerMentions.includes(keyword));
  }
}
