import { Bot, GrammyError, HttpError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

export interface BotInfo {
  id: number;
  isBot: boolean;
  firstName: string;
  username: string;
  canJoinGroups: boolean;
  canReadAllGroupMessages: boolean;
  supportsInlineQueries: boolean;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Fetches Telegram bot metadata via getMe to verify token + capabilities.
 */
export async function probeBot(token: string): Promise<BotInfo> {
  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    throw new Error('Telegram bot token is required for health probe');
  }

  const bot = new Bot(trimmedToken);
  try {
    const me = await bot.api.getMe();

    return {
      id: me.id,
      isBot: Boolean(me.is_bot),
      firstName: me.first_name,
      username: me.username ?? '',
      canJoinGroups: Boolean(me.can_join_groups),
      canReadAllGroupMessages: Boolean(me.can_read_all_group_messages),
      supportsInlineQueries: Boolean(me.supports_inline_queries),
    };
  } catch (err) {
    handleProbeError(err);
  }
}

export async function probeTelegramBot(bot: Bot): Promise<UserFromGetMe> {
  try {
    return await bot.api.getMe();
  } catch (err) {
    handleProbeError(err);
  }
}

export function validateBotCapabilities(info: BotInfo): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!info.isBot) {
    errors.push('Provided token does not belong to a bot account');
  }
  if (!info.canJoinGroups) {
    errors.push('Bot must be allowed to join groups for TelegramChannel');
  }
  if (!info.canReadAllGroupMessages) {
    warnings.push(
      'Bot privacy mode is enabled; disable it to read all group messages',
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

function handleProbeError(err: unknown): never {
  if (err instanceof GrammyError) {
    if (err.error_code === 401) {
      throw new Error('Invalid Telegram bot token (401 Unauthorized)', {
        cause: err,
      });
    }
    throw new Error(`Telegram API error ${err.error_code}: ${err.description}`, {
      cause: err,
    });
  }
  if (err instanceof HttpError) {
    const detail =
      typeof err.error === 'string'
        ? err.error
        : err.error instanceof Error
          ? err.error.message
          : 'unknown network error';
    throw new Error(`Network error while reaching Telegram: ${detail}`, {
      cause: err,
    });
  }
  throw err instanceof Error ? err : new Error('Unknown Telegram probe error', { cause: err });
}
