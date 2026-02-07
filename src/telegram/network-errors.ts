export const RECOVERABLE_ERROR_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
] as const;

const RECOVERABLE_ERROR_CODE_SET = new Set(
  RECOVERABLE_ERROR_CODES.map((code) => code.toUpperCase()),
);

const GET_UPDATES_CONFLICT_PATTERN = /terminated by other getUpdates request/i;
const BOT_KICKED_PATTERN = /bot was kicked/i;
const BOT_BLOCKED_PATTERN = /bot was blocked/i;
const TOKEN_INVALID_PATTERN = /(unauthorized|bot token is invalid|invalid token)/i;
const CHAT_NOT_FOUND_PATTERN = /chat not found/i;

const NESTED_ERROR_KEYS = [
  'error',
  'cause',
  'originalError',
  'response',
  'err',
  'source',
  'result',
  'body',
  'data',
] as const;

const TEXT_FIELD_KEYS = ['description', 'message', 'statusText', 'detail', 'body'] as const;

const MAX_ERROR_OBJECTS = 16;

export function isRecoverableError(error: unknown): boolean {
  const code = getErrorCode(error);
  return Boolean(code && RECOVERABLE_ERROR_CODE_SET.has(code.toUpperCase()));
}

export function isGetUpdatesConflict(error: unknown): boolean {
  return hasStatusCode(error, 409) || matchesErrorText(error, GET_UPDATES_CONFLICT_PATTERN);
}

export function isBotKicked(error: unknown): boolean {
  const code = getErrorCode(error);
  const textMatch = matchesErrorText(error, BOT_KICKED_PATTERN);
  if (!textMatch) {
    return false;
  }

  return !code || code === '403';
}

export function isBotBlocked(error: unknown): boolean {
  const code = getErrorCode(error);
  const textMatch = matchesErrorText(error, BOT_BLOCKED_PATTERN);
  if (!textMatch) {
    return false;
  }

  return !code || code === '403';
}

export function isTokenInvalid(error: unknown): boolean {
  return hasStatusCode(error, 401) || matchesErrorText(error, TOKEN_INVALID_PATTERN);
}

export function isChatNotFound(error: unknown): boolean {
  const code = getErrorCode(error);
  return matchesErrorText(error, CHAT_NOT_FOUND_PATTERN) && (!code || code === '400');
}

export function getErrorCode(error: unknown): string | null {
  if (typeof error === 'string') {
    const normalized = normalizeCodeCandidate(error);
    if (normalized) {
      return normalized;
    }
  }

  if (typeof error === 'number' && Number.isFinite(error)) {
    return String(error);
  }

  if (!isRecord(error)) {
    return null;
  }

  const objects = collectErrorObjects(error);
  for (const obj of objects) {
    const candidate = extractCode(obj);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function hasStatusCode(error: unknown, status: number): boolean {
  const code = getErrorCode(error);
  return code === String(status);
}

function matchesErrorText(error: unknown, pattern: RegExp): boolean {
  for (const text of getErrorTexts(error)) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

function getErrorTexts(error: unknown): string[] {
  const texts = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        texts.add(trimmed);
      }
    }
  };

  if (typeof error === 'string') {
    add(error);
  } else if (error instanceof Error) {
    add(error.message);
  }

  if (isRecord(error)) {
    for (const obj of collectErrorObjects(error)) {
      for (const key of TEXT_FIELD_KEYS) {
        add(obj[key]);
      }
    }
  }

  return Array.from(texts);
}

function extractCode(obj: Record<string, unknown>): string | null {
  const candidateKeys = [
    'code',
    'errno',
    'statusCode',
    'status',
    'error_code',
    'errorCode',
    'status_code',
  ];

  for (const key of candidateKeys) {
    const value = obj[key];
    const normalized = normalizeCodeCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeCodeCandidate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    if (/^[a-z0-9_-]+$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }
  }

  return null;
}

function collectErrorObjects(value: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();
  const results: Record<string, unknown>[] = [];

  while (queue.length && results.length < MAX_ERROR_OBJECTS) {
    const current = queue.shift();
    if (!isRecord(current) || visited.has(current)) {
      continue;
    }

    visited.add(current);
    results.push(current);

    for (const key of NESTED_ERROR_KEYS) {
      if (key in current) {
        const next = (current as Record<string, unknown>)[key];
        if (next !== undefined && next !== null) {
          queue.push(next);
        }
      }
    }
  }

  return results;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
