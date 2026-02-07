import { isAllowed as isStoredAllowlisted } from './allowlist-store.js';
import { generatePairingCode, getPendingPairings } from './pairing-store.js';
import { isNumericId, normalizeTarget } from './targets.js';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface AccessConfig {
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  allowFrom?: string[];
  groupAllowFrom?: string[];
}

export interface AccessResult {
  allowed: boolean;
  reason: string;
  pairingCode?: string;
}

/**
 * Evaluate DM policy for a Telegram user.
 */
export async function checkDmAccess(
  userId: string,
  username: string | undefined,
  config: AccessConfig,
): Promise<AccessResult> {
  if (config.dmPolicy === 'disabled') {
    return {
      allowed: false,
      reason: 'DMs are disabled for this bot',
    };
  }

  if (config.dmPolicy === 'open') {
    return { allowed: true, reason: 'DM policy is open' };
  }

  const configAllowed = isUserAllowedByConfig(userId, username, config.allowFrom);
  const storeAllowed = configAllowed
    ? false
    : await isStoredAllowlisted(userId, username);

  const allowedReason = configAllowed
    ? 'Sender is allowlisted via config'
    : storeAllowed
      ? 'Sender is allowlisted'
      : null;

  switch (config.dmPolicy) {
    case 'allowlist':
      return allowedReason
        ? { allowed: true, reason: allowedReason }
        : { allowed: false, reason: 'Sender is not allowlisted' };
    case 'pairing': {
      if (allowedReason) {
        return { allowed: true, reason: allowedReason };
      }
      // For DMs, chatId === userId.
      const pairingCode = await ensurePairingCode(userId, userId, username);
      return {
        allowed: false,
        reason: 'Sender must complete pairing',
        pairingCode,
      };
    }
    default:
      return {
        allowed: false,
        reason: `Unknown DM policy: ${config.dmPolicy}`,
      };
  }
}

/**
 * Evaluate group policy for a Telegram chat.
 */
export async function checkGroupAccess(
  chatId: string,
  config: AccessConfig,
): Promise<AccessResult> {
  switch (config.groupPolicy) {
    case 'disabled':
      return {
        allowed: false,
        reason: 'Group access is disabled for this bot',
      };
    case 'open':
      return { allowed: true, reason: 'Group policy is open' };
    case 'allowlist': {
      const allowed = isChatAllowedByConfig(chatId, config.groupAllowFrom);
      return allowed
        ? { allowed: true, reason: 'Group chat is allowlisted' }
        : { allowed: false, reason: 'Group chat is not allowlisted' };
    }
    default:
      return {
        allowed: false,
        reason: `Unknown group policy: ${config.groupPolicy}`,
      };
  }
}

/**
 * Produce a human-readable pairing prompt for unknown DM senders.
 */
export async function generatePairingResponse(
  userId: string,
  username: string | undefined,
  chatId: string,
): Promise<string> {
  const pairingCode = await ensurePairingCode(chatId, userId, username);
  const handle = formatTelegramHandle(userId, username);
  return [
    `Hi ${handle}, this bot requires approval before new senders can DM.`,
    `Pairing code: ${pairingCode}`,
    'Ask the bot owner to approve you with:',
    `openclaw pairing approve telegram ${pairingCode}`,
    'Once approved, resend your message to continue.',
  ].join('\n');
}

async function ensurePairingCode(
  chatId: string,
  userId: string,
  username?: string,
): Promise<string> {
  const pending = await getPendingPairings();
  const existing = pending.find(
    (entry) => entry.chatId === chatId && entry.userId === userId,
  );
  if (existing) {
    return existing.code;
  }
  return generatePairingCode(chatId, userId, username);
}

function isUserAllowedByConfig(
  userId: string,
  username: string | undefined,
  entries?: string[],
): boolean {
  const parsed = parseUserAllowEntries(entries);
  if (parsed.wildcard) {
    return true;
  }

  const normalizedId = normalizeUserId(userId);
  if (normalizedId && parsed.ids.has(normalizedId)) {
    return true;
  }

  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername && parsed.usernames.has(normalizedUsername)) {
    return true;
  }

  return false;
}

function isChatAllowedByConfig(chatId: string, entries?: string[]): boolean {
  const parsed = parseChatAllowEntries(entries);
  if (parsed.wildcard) {
    return true;
  }
  const normalizedChatId = normalizeTarget(chatId);
  if (!normalizedChatId) {
    return false;
  }
  return parsed.chats.has(normalizedChatId);
}

function parseUserAllowEntries(entries?: string[]): {
  wildcard: boolean;
  ids: Set<string>;
  usernames: Set<string>;
} {
  const result = {
    wildcard: false,
    ids: new Set<string>(),
    usernames: new Set<string>(),
  };
  for (const entry of entries ?? []) {
    const normalized = normalizeUserAllowEntry(entry);
    if (!normalized) {
      continue;
    }
    if (normalized === 'wildcard') {
      result.wildcard = true;
    } else if (normalized.type === 'id') {
      result.ids.add(normalized.value);
    } else if (normalized.type === 'username') {
      result.usernames.add(normalized.value);
    }
  }
  return result;
}

function parseChatAllowEntries(entries?: string[]): {
  wildcard: boolean;
  chats: Set<string>;
} {
  const result = {
    wildcard: false,
    chats: new Set<string>(),
  };
  for (const entry of entries ?? []) {
    const normalized = normalizeChatAllowEntry(entry);
    if (!normalized) {
      continue;
    }
    if (normalized === 'wildcard') {
      result.wildcard = true;
    } else {
      result.chats.add(normalized.value);
    }
  }
  return result;
}

type UserAllowEntry =
  | { type: 'id'; value: string }
  | { type: 'username'; value: string }
  | 'wildcard';

function normalizeUserAllowEntry(value: string): UserAllowEntry | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === '*') {
    return 'wildcard';
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('id:')) {
    const id = normalizeUserId(trimmed.slice(3));
    return id ? { type: 'id', value: id } : null;
  }
  if (lower.startsWith('user:')) {
    const id = normalizeUserId(trimmed.slice(5));
    return id ? { type: 'id', value: id } : null;
  }
  if (lower.startsWith('username:')) {
    const normalizedUsername = normalizeUsername(trimmed.slice(9));
    return normalizedUsername
      ? { type: 'username', value: normalizedUsername }
      : null;
  }

  const normalized = normalizeTarget(trimmed);
  if (!normalized) {
    return null;
  }
  if (isNumericValue(normalized)) {
    return { type: 'id', value: normalized };
  }
  return { type: 'username', value: normalized };
}

type ChatAllowEntry = { type: 'chat'; value: string } | 'wildcard';

function normalizeChatAllowEntry(value: string): ChatAllowEntry | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === '*') {
    return 'wildcard';
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('chat:')) {
    const normalized = normalizeTarget(trimmed.slice(5));
    return normalized ? { type: 'chat', value: normalized } : null;
  }
  if (lower.startsWith('group:')) {
    const normalized = normalizeTarget(trimmed.slice(6));
    return normalized ? { type: 'chat', value: normalized } : null;
  }

  const normalized = normalizeTarget(trimmed);
  return normalized ? { type: 'chat', value: normalized } : null;
}

function normalizeUserId(value?: string): string | null {
  if (!value) {
    return null;
  }
  if (!isNumericId(value)) {
    return null;
  }
  const normalized = normalizeTarget(value);
  return isNumericValue(normalized) ? normalized : null;
}

function normalizeUsername(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeTarget(value);
  if (!normalized) {
    return null;
  }
  return isNumericValue(normalized) ? null : normalized;
}

function isNumericValue(value: string): boolean {
  return /^-?\d+$/.test(value);
}

function formatTelegramHandle(userId: string, username?: string): string {
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername) {
    return `@${normalizedUsername}`;
  }
  return userId;
}
