const TELEGRAM_PREFIXES = ['telegram:', 'tg:'];
const NUMERIC_ID_REGEX = /^-?\d+$/;

export type TargetType = 'id' | 'username';

export interface TelegramMessageTarget {
  type: TargetType;
  value: string;
  threadId?: number;
}

export function resolveTelegramTarget(
  target: string | number | { chatId: string; threadId?: number },
): { chatId: string; threadId?: number } {
  if (typeof target === 'object' && target !== null && 'chatId' in target) {
    return target;
  }

  const value = normalizeTarget(String(target));
  return { chatId: value };
}

export function normalizeTarget(target: string): string {
  const raw = extractRawTarget(target);
  if (!raw) {
    return '';
  }
  return isNumericValue(raw) ? raw : raw.toLowerCase();
}

export function isNumericId(target: string): boolean {
  const raw = extractRawTarget(target);
  if (!raw) {
    return false;
  }
  return isNumericValue(raw);
}

export function parseTarget(target: string): TelegramMessageTarget {
  const normalized = normalizeTarget(target);
  const type: TargetType = isNumericValue(normalized) ? 'id' : 'username';
  return { type, value: normalized };
}

export function formatChatId(chatId: string | number, threadId?: number): string {
  const base = typeof chatId === 'number' ? chatId.toString() : normalizeTarget(chatId);
  if (threadId === undefined) {
    return base;
  }

  return `${base}:${threadId}`;
}

function stripPrefixes(value: string): string {
  let candidate = value.trim();
  if (!candidate) {
    return '';
  }

  const lowerCandidate = candidate.toLowerCase();
  for (const prefix of TELEGRAM_PREFIXES) {
    if (lowerCandidate.startsWith(prefix)) {
      candidate = candidate.slice(prefix.length).trim();
      break;
    }
  }

  return candidate;
}

function extractRawTarget(target: string): string {
  let value = stripPrefixes(target);
  if (value.startsWith('@')) {
    value = value.slice(1);
  }
  return value.trim();
}

function isNumericValue(value: string): boolean {
  return NUMERIC_ID_REGEX.test(value);
}

export function createAttachmentPlaceholder(type: string, detail?: string): string {
  const suffix = detail ? ` ${detail}` : '';
  return `[${type}${suffix}]`;
}
