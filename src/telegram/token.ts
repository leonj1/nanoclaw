import fs from 'fs';

import type { TelegramChannelConfig } from './types.js';

export function resolveTelegramToken(config: TelegramChannelConfig): string {
  if (config.botToken) {
    return config.botToken.trim();
  }

  if (config.tokenFile) {
    const contents = fs.readFileSync(config.tokenFile, 'utf8').trim();
    if (!contents) {
      throw new Error('Telegram token file is empty');
    }
    return contents;
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) {
    return envToken.trim();
  }

  throw new Error('Missing Telegram bot token');
}
