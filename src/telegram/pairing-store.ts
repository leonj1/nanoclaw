import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { normalizeTelegramId, normalizeUsername } from './targets.js';

const TELEGRAM_STATE_DIR = path.join(DATA_DIR, 'telegram');
const PAIRING_PATH = path.join(TELEGRAM_STATE_DIR, 'pairing.json');

const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PENDING_PER_CHAT = 3;

export interface PairingRequest {
  code: string;
  userId: string;
  username?: string;
  chatId: string;
  createdAt: number;
  expiresAt: number;
}

interface PairingStoreData {
  requests: PairingRequest[];
}

/**
 * Create (or refresh) a pairing request entry for a Telegram sender.
 */
export async function upsertPairingRequest(
  userId: string,
  username: string | undefined,
  chatId: string,
): Promise<PairingRequest> {
  const normalizedUserId = normalizeTelegramId(userId);
  const normalizedChatId = normalizeTelegramId(chatId);
  const normalizedUsername = normalizeUsername(username);
  const now = Date.now();

  const store = await loadPairingStore();
  const existing = store.requests.find(
    (request) => request.userId === normalizedUserId,
  );

  if (existing) {
    existing.username = normalizedUsername ?? existing.username;
    existing.chatId = normalizedChatId;
    existing.createdAt = now;
    existing.expiresAt = now + PAIRING_TTL_MS;
    await writePairingStore(store);
    return existing;
  }

  enforceChatQuota(store, normalizedChatId);

  const newRequest: PairingRequest = {
    code: generatePairingCode(new Set(store.requests.map((r) => r.code))),
    userId: normalizedUserId,
    username: normalizedUsername,
    chatId: normalizedChatId,
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
  };

  store.requests.push(newRequest);
  await writePairingStore(store);
  return newRequest;
}

async function loadPairingStore(): Promise<PairingStoreData> {
  await ensureStateDir();
  try {
    const raw = await fs.readFile(PAIRING_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PairingStoreData>;
    const normalized = normalizeRequests(parsed.requests ?? []);
    if (normalized.dirty) {
      await writePairingStore({ requests: normalized.requests });
    }
    return { requests: normalized.requests };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { requests: [] };
    }
    throw err;
  }
}

async function writePairingStore(data: PairingStoreData): Promise<void> {
  await ensureStateDir();
  await fs.writeFile(PAIRING_PATH, JSON.stringify(data, null, 2));
}

function normalizeRequests(requests: Partial<PairingRequest>[]): {
  dirty: boolean;
  requests: PairingRequest[];
} {
  const now = Date.now();
  const result: PairingRequest[] = [];
  let dirty = false;
  for (const req of requests) {
    if (
      !req ||
      typeof req.code !== 'string' ||
      typeof req.userId !== 'string' ||
      typeof req.chatId !== 'string'
    ) {
      dirty = true;
      continue;
    }
    if (typeof req.expiresAt !== 'number' || req.expiresAt <= now) {
      dirty = true;
      continue;
    }
    result.push({
      code: req.code,
      userId: normalizeTelegramId(req.userId),
      username: normalizeUsername(req.username),
      chatId: normalizeTelegramId(req.chatId),
      createdAt: typeof req.createdAt === 'number' ? req.createdAt : now,
      expiresAt: req.expiresAt,
    });
  }
  return { dirty, requests: result };
}

function generatePairingCode(existingCodes: Set<string>): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  while (true) {
    let candidate = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
      const index = crypto.randomInt(0, alphabet.length);
      candidate += alphabet[index];
    }
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }
}

function enforceChatQuota(store: PairingStoreData, chatId: string): void {
  const relevant = store.requests.filter((req) => req.chatId === chatId);
  const overflow = relevant.length - MAX_PENDING_PER_CHAT + 1;
  if (overflow <= 0) return;

  relevant
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .slice(0, overflow)
    .forEach((req) => {
      const index = store.requests.findIndex((r) => r.code === req.code);
      if (index >= 0) {
        store.requests.splice(index, 1);
      }
    });
}

async function ensureStateDir(): Promise<void> {
  await fs.mkdir(TELEGRAM_STATE_DIR, { recursive: true });
}
