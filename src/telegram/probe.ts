import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

export async function probeTelegramBot(bot: Bot): Promise<UserFromGetMe> {
  const me = await bot.api.getMe();
  return me;
}
