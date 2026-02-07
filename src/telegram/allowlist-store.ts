import { promises as fs } from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import {
  TelegramUserTarget,
  buildChatMatchToken,
  buildUserMatchTokens,
  normalizeTelegramId,
  normalizeUsername,
} from './targets.js';

const TELEGRAM_STATE_DIR = path.join(DATA_DIR, 'telegram');
const ALLOWLIST_PATH = path.join(TELEGRAM_STATE_DIR, 'allowlist.json');

interface AllowlistData {
  users: string[];
  chats: string[];
}

interface TokenSet {
  wildcard: boolean;
  tokens: Set<string>;
}

/**
 * Check whether a DM sender is either statically allowed (config) or dynamically
 * allowlisted via the on-disk store.
 */
export async function isAllowed(
  target: TelegramUserTarget,
  overrideEntries?: string[],
): Promise<boolean> {
  const tokens = buildUserMatchTokens(target.userId, target.username);
  const configSet = buildUserTokenSet(overrideEntries);
  if (configSet.wildcard) {
    return true;
  }
  if (tokens.some((token) => configSet.tokens.has(token))) {
    return true;
  }
  const store = await readAllowlist();
  const storeTokens = new Set(store.users);
  return tokens.some((token) => storeTokens.has(token));
}

/**
 * Check whether a group chat is allowed according to policy (config + store).
 */
export async function isChatAllowed(
  chatId: string,
  overrideEntries?: string[],
): Promise<boolean> {
  const chatToken = buildChatMatchToken(chatId);
  const configSet = buildChatTokenSet(overrideEntries);
  if (configSet.wildcard) {
    return true;
  }
  if (configSet.tokens.has(chatToken)) {
    return true;
  }
  const store = await readAllowlist();
  const storeTokens = new Set(store.chats);
  return storeTokens.has(chatToken);
}

/**
 * Persist a DM sender into the allowlist store.
 */
export async function addUser(target: TelegramUserTarget): Promise<void> {
  const tokens = buildUserMatchTokens(target.userId, target.username);
  if (tokens.length === 0) return;
  const allowlist = await readAllowlist();
  const merged = new Set([...allowlist.users, ...tokens]);
  allowlist.users = Array.from(merged);
  await writeAllowlist(allowlist);
}

/**
 * Persist a group/chat identifier into the allowlist store.
 */
export async function addChat(chatId: string): Promise<void> {
  const chatToken = buildChatMatchToken(chatId);
  if (!chatToken) return;
  const allowlist = await readAllowlist();
  const merged = new Set([...allowlist.chats, chatToken]);
  allowlist.chats = Array.from(merged);
  await writeAllowlist(allowlist);
}

async function readAllowlist(): Promise<AllowlistData> {
  await ensureStateDir();
  try {
    const raw = await fs.readFile(ALLOWLIST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AllowlistData>;
    return {
      users: dedupeTokens(parsed.users ?? []),
      chats: dedupeTokens(parsed.chats ?? []),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { users: [], chats: [] };
    }
    throw err;
  }
}

async function writeAllowlist(data: AllowlistData): Promise<void> {
  await ensureStateDir();
  await fs.writeFile(ALLOWLIST_PATH, JSON.stringify(data, null, 2));
}

function dedupeTokens(values: unknown[]): string[] {
  if (!Array.isArray(values)) return [];
  const filtered = values.filter((value): value is string =>
    typeof value === 'string' && value.trim().length > 0,
  );
  return Array.from(new Set(filtered));
}

async function ensureStateDir(): Promise<void> {
  await fs.mkdir(TELEGRAM_STATE_DIR, { recursive: true });
}

function buildUserTokenSet(entries?: string[]): TokenSet {
  const set: TokenSet = { wildcard: false, tokens: new Set() };
  for (const entry of entries ?? []) {
    const normalized = normalizeUserAllowEntry(entry);
    if (normalized === 'wildcard') {
      set.wildcard = true;
    } else if (normalized) {
      set.tokens.add(normalized);
    }
  }
  return set;
}

function buildChatTokenSet(entries?: string[]): TokenSet {
  const set: TokenSet = { wildcard: false, tokens: new Set() };
  for (const entry of entries ?? []) {
    const normalized = normalizeChatAllowEntry(entry);
    if (normalized === 'wildcard') {
      set.wildcard = true;
    } else if (normalized) {
      set.tokens.add(normalized);
    }
  }
  return set;
}

function normalizeUserAllowEntry(
  rawValue: string,
): string | 'wildcard' | null {
  if (!rawValue) return null;
  let value = stripProtocolPrefix(rawValue);
  if (!value) return null;
  if (value === '*') return 'wildcard';

  const firstColon = value.indexOf(':');
  if (firstColon > 0) {
    const prefix = value.slice(0, firstColon).toLowerCase();
    const rest = value.slice(firstColon + 1);
    if (prefix === 'user' || prefix === 'id') {
      const id = normalizeTelegramId(rest);
      return id ? `id:${id}` : null;
    }
    if (prefix === 'username') {
      const username = normalizeUsername(rest);
      return username ? `username:${username}` : null;
    }
  }

  if (value.startsWith('@')) {
    const username = normalizeUsername(value.slice(1));
    return username ? `username:${username}` : null;
  }

  if (/^-?\d+$/.test(value)) {
    return `id:${normalizeTelegramId(value)}`;
  }

  const username = normalizeUsername(value);
  return username ? `username:${username}` : null;
}

function normalizeChatAllowEntry(
  rawValue: string,
): string | 'wildcard' | null {
  if (!rawValue) return null;
  let value = stripProtocolPrefix(rawValue);
  if (!value) return null;
  if (value === '*') return 'wildcard';

  const firstColon = value.indexOf(':');
  if (firstColon > 0) {
    const prefix = value.slice(0, firstColon).toLowerCase();
    const rest = value.slice(firstColon + 1);
    if (prefix === 'chat' || prefix === 'group') {
      value = rest;
    }
  }

  if (value.startsWith('@')) {
    const username = normalizeUsername(value.slice(1));
    return username ? `chat:${username}` : null;
  }

  const id = normalizeTelegramId(value);
  return id ? `chat:${id}` : null;
}

function stripProtocolPrefix(rawValue: string): string {
  let value = rawValue.trim();
  while (value.toLowerCase().startsWith('telegram:')) {
    value = value.slice(9).trim();
  }
  while (value.toLowerCase().startsWith('tg:')) {
    value = value.slice(3).trim();
  }
  return value;
}
