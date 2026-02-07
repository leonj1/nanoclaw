const TELEGRAM_PREFIXES = ["telegram:", "tg:"];
const NUMERIC_ID_REGEX = /^-?\d+$/;

type TargetType = "id" | "username";

function stripPrefixes(value: string): string {
  let candidate = value.trim();
  if (!candidate) {
    return "";
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
  if (value.startsWith("@")) {
    value = value.slice(1);
  }
  return value.trim();
}

function isNumericValue(value: string): boolean {
  return NUMERIC_ID_REGEX.test(value);
}

export function normalizeTarget(target: string): string {
  const raw = extractRawTarget(target);
  if (!raw) {
    return "";
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

export function parseTarget(target: string): { type: TargetType; value: string } {
  const normalized = normalizeTarget(target);
  const type: TargetType = isNumericValue(normalized) ? "id" : "username";

  return { type, value: normalized };
}

export function formatChatId(chatId: string | number, threadId?: number): string {
  const base = typeof chatId === "number" ? chatId.toString() : normalizeTarget(chatId);
  if (threadId === undefined) {
    return base;
  }

  return `${base}:${threadId}`;
}
