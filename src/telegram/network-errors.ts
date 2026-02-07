import { GrammyError, HttpError } from 'grammy';

function extractTelegramDescription(error: unknown): string {
  if (error instanceof GrammyError) {
    return error.description;
  }
  if (error instanceof HttpError) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'description' in error) {
    const description = (error as { description?: string }).description;
    return description ?? '';
  }
  return '';
}

export function isHtmlParseError(error: unknown): boolean {
  const description = extractTelegramDescription(error).toLowerCase();
  return description.includes("can't parse entities") ||
    description.includes("can't parse message text") ||
    description.includes('parse_mode');
}

export function isRateLimitedError(error: unknown): boolean {
  if (error instanceof GrammyError) {
    return error.error_code === 429;
  }
  const description = extractTelegramDescription(error).toLowerCase();
  return description.includes('too many requests') || description.includes('retry after');
}

export function isRetryableTelegramError(error: unknown): boolean {
  if (isRateLimitedError(error)) {
    return true;
  }
  if (error instanceof HttpError) {
    return true;
  }
  if (error instanceof GrammyError) {
    return error.error_code >= 500;
  }
  return false;
}
