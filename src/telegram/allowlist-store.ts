import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';

const TELEGRAM_ALLOWLIST_FILE = path.join(STORE_DIR, 'telegram-allowlist.json');

export interface AllowlistEntry {
  channel: string;
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatId?: number;
  addedAt: number;
}

interface AllowlistStoreFile {
  entries: AllowlistEntry[];
}

const DEFAULT_STORE: AllowlistStoreFile = { entries: [] };

function ensureStoreDir(): void {
  fs.mkdirSync(path.dirname(TELEGRAM_ALLOWLIST_FILE), { recursive: true });
}

function readStore(): AllowlistStoreFile {
  try {
    const raw = fs.readFileSync(TELEGRAM_ALLOWLIST_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AllowlistStoreFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { ...DEFAULT_STORE };
    }
    return parsed;
  } catch (err) {
    if (isNoEntryError(err)) {
      return { ...DEFAULT_STORE };
    }
    throw err;
  }
}

function saveStore(store: AllowlistStoreFile): void {
  ensureStoreDir();
  fs.writeFileSync(TELEGRAM_ALLOWLIST_FILE, JSON.stringify(store, null, 2));
}

function isNoEntryError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT');
}

function normalizeUsername(username?: string): string | undefined {
  if (!username) return undefined;
  return username.replace(/^@/, '').trim().toLowerCase();
}

export function getTelegramAllowlist(): AllowlistEntry[] {
  const store = readStore();
  return store.entries
    .filter((entry) => entry.channel === 'telegram')
    .sort((a, b) => a.addedAt - b.addedAt);
}

export function addTelegramAllowEntry(entry: {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatId?: number;
}): AllowlistEntry {
  const store = readStore();
  const normalizedUsername = normalizeUsername(entry.username);
  const existing = store.entries.find(
    (stored) => stored.channel === 'telegram' && stored.userId === entry.userId,
  );

  if (existing) {
    // Update username if we have a new one
    if (normalizedUsername && existing.username !== normalizedUsername) {
      existing.username = normalizedUsername;
      saveStore(store);
    }
    return existing;
  }

  const newEntry: AllowlistEntry = {
    channel: 'telegram',
    userId: entry.userId,
    username: normalizedUsername,
    firstName: entry.firstName?.trim() || undefined,
    lastName: entry.lastName?.trim() || undefined,
    chatId: entry.chatId,
    addedAt: Date.now(),
  };

  store.entries.push(newEntry);
  saveStore(store);
  return newEntry;
}
