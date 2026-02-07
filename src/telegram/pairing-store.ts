import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';

const TELEGRAM_PAIRING_FILE = path.join(STORE_DIR, 'telegram-pairings.json');

export interface PairingRequest {
  code: string;
  channel: string;
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatId: number;
  createdAt: number;
  expiresAt: number;
}

interface PairingStoreFile {
  entries: PairingRequest[];
}

const DEFAULT_STORE: PairingStoreFile = { entries: [] };

export class PairingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingStoreError';
  }
}

export class PairingNotFoundError extends PairingStoreError {
  constructor(code: string) {
    super(`Pairing code ${code} was not found.`);
    this.name = 'PairingNotFoundError';
  }
}

export class PairingExpiredError extends PairingStoreError {
  entry: PairingRequest;

  constructor(entry: PairingRequest) {
    super(`Pairing code ${entry.code} expired at ${new Date(entry.expiresAt).toISOString()}.`);
    this.name = 'PairingExpiredError';
    this.entry = entry;
  }
}

function ensureStoreDir(): void {
  fs.mkdirSync(path.dirname(TELEGRAM_PAIRING_FILE), { recursive: true });
}

function readStore(): PairingStoreFile {
  try {
    const raw = fs.readFileSync(TELEGRAM_PAIRING_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PairingStoreFile;
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

function saveStore(store: PairingStoreFile): void {
  ensureStoreDir();
  fs.writeFileSync(TELEGRAM_PAIRING_FILE, JSON.stringify(store, null, 2));
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function isNoEntryError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT');
}

function cleanupExpired(store: PairingStoreFile, now: number): PairingRequest[] {
  const activeEntries = store.entries.filter((entry) => entry.expiresAt > now);
  if (activeEntries.length !== store.entries.length) {
    store.entries = activeEntries;
    saveStore(store);
  }
  return activeEntries;
}

export function getPendingPairings(channel: string): PairingRequest[] {
  const store = readStore();
  const now = Date.now();
  const entries = cleanupExpired(store, now);
  return entries.filter((entry) => entry.channel === channel);
}

export function approvePairing(code: string, channel?: string): PairingRequest {
  const normalizedCode = normalizeCode(code);
  const store = readStore();
  const now = Date.now();

  const index = store.entries.findIndex((entry) => entry.code.toUpperCase() === normalizedCode);
  if (index === -1) {
    throw new PairingNotFoundError(code);
  }

  const entry = store.entries[index];
  if (channel && entry.channel !== channel) {
    throw new PairingNotFoundError(code);
  }

  if (entry.expiresAt <= now) {
    store.entries.splice(index, 1);
    saveStore(store);
    throw new PairingExpiredError(entry);
  }

  store.entries.splice(index, 1);
  saveStore(store);
  return entry;
}

export function rejectPairing(code: string, channel?: string): PairingRequest {
  const normalizedCode = normalizeCode(code);
  const store = readStore();
  const now = Date.now();

  const index = store.entries.findIndex((entry) => entry.code.toUpperCase() === normalizedCode);
  if (index === -1) {
    throw new PairingNotFoundError(code);
  }

  const entry = store.entries[index];
  if (channel && entry.channel !== channel) {
    throw new PairingNotFoundError(code);
  }

  if (entry.expiresAt <= now) {
    store.entries.splice(index, 1);
    saveStore(store);
    throw new PairingExpiredError(entry);
  }

  store.entries.splice(index, 1);
  saveStore(store);
  return entry;
}
