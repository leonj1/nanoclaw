import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { TelegramChannelConfig } from './types.js';

const TELEGRAM_TOKEN_REGEX = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

function validateToken(token: string, source: string): string {
  if (!TELEGRAM_TOKEN_REGEX.test(token)) {
    throw new Error(
      `Invalid Telegram bot token format from ${source}. Expected format like "123456:ABC-DEF".`,
    );
  }

  return token;
}

export function resolveTelegramToken(config: TelegramChannelConfig): string {
  const { tokenFile, botToken } = config;

  if (tokenFile) {
    const absolutePath = resolvePath(tokenFile);

    try {
      accessSync(absolutePath, constants.R_OK);
    } catch (error) {
      throw new Error(
        `Telegram bot token file ${absolutePath} is not readable: ${(error as Error).message}`,
      );
    }

    let fileContents: string;

    try {
      fileContents = readFileSync(absolutePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Unable to read Telegram bot token from ${absolutePath}: ${(error as Error).message}`,
      );
    }

    const tokenFromFile = fileContents.trim();

    if (!tokenFromFile) {
      throw new Error(`Telegram bot token file ${absolutePath} is empty.`);
    }

    return validateToken(tokenFromFile, `file ${absolutePath}`);
  }

  if (botToken && botToken.trim()) {
    return validateToken(botToken.trim(), 'config.botToken');
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN;

  if (envToken && envToken.trim()) {
    return validateToken(envToken.trim(), 'TELEGRAM_BOT_TOKEN environment variable');
  }

  throw new Error(
    'Telegram bot token not provided. Set config.tokenFile, config.botToken, or TELEGRAM_BOT_TOKEN.',
  );
}
