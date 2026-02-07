export interface TelegramUserTarget {
  userId: string;
  username?: string;
}

export interface TelegramChatTarget {
  chatId: string;
}

/**
 * Normalize a Telegram identifier (user ID or chat ID).
 */
export function normalizeTelegramId(value: string): string {
  return value.trim();
}

/**
 * Normalize a Telegram username for case-insensitive comparisons.
 */
export function normalizeUsername(username?: string): string | undefined {
  if (!username) return undefined;
  const normalized = username.replace(/^@/, '').trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Build the set of token keys that can match a DM sender in allowlist lookups.
 * Tokens include the numeric user ID and optional username.
 */
export function buildUserMatchTokens(
  userId: string,
  username?: string,
): string[] {
  const tokens = new Set<string>();
  const normalizedId = normalizeTelegramId(userId);
  if (normalizedId) {
    tokens.add(`id:${normalizedId}`);
  }
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername) {
    tokens.add(`username:${normalizedUsername}`);
  }
  return Array.from(tokens);
}

/**
 * Build the token used to match group/chat identifiers.
 */
export function buildChatMatchToken(chatId: string): string {
  return `chat:${normalizeTelegramId(chatId)}`;
}

/**
 * Format a friendly handle for logs or user-facing messages.
 */
export function formatTelegramHandle(
  userId: string,
  username?: string,
): string {
  const normalizedUsername = username?.replace(/^@/, '');
  return normalizedUsername && normalizedUsername.length > 0
    ? `@${normalizedUsername}`
    : userId;
}
