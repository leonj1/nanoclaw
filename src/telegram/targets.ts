import type { TelegramMessageTarget } from './types.js';

export function resolveTelegramTarget(
  target: string | number | TelegramMessageTarget,
): TelegramMessageTarget {
  if (typeof target === 'object' && target !== null) {
    return target;
  }

  return { chatId: String(target) };
}

export function createAttachmentPlaceholder(
  type: string,
  detail?: string,
): string {
  const suffix = detail ? ` ${detail}` : '';
  return `[${type}${suffix}]`;
}
