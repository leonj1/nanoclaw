import crypto from 'crypto';
import os from 'os';
import path from 'path';
import type { FileHandle } from 'fs/promises';
import * as fs from 'fs/promises';

const CREDENTIALS_DIR = path.join(os.homedir(), '.nanoclaw', 'credentials');
const STORE_FILE = path.join(CREDENTIALS_DIR, 'telegram-pairing.json');
const LOCK_FILE = path.join(CREDENTIALS_DIR, 'telegram-pairing.lock');

const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_PENDING_PER_CHAT = 3;
const PAIRING_TTL_MS = 60 * 60 * 1000;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;

export interface PairingEntry {
  code: string;
  chatId: string;
  userId: string;
  username?: string;
  createdAt: number;
  expiresAt: number;
}

interface PairingStoreFile {
  pairings: PairingEntry[];
}

export async function generatePairingCode(
  chatId: string,
  userId: string,
  username?: string,
): Promise<string> {
  return withLock(async () => {
    let entries = await readStore();
    let dirty = false;

    const pruneResult = pruneExpired(entries);
    entries = pruneResult.entries;
    if (pruneResult.removed) {
      dirty = true;
    }

    const pendingForChat = entries.filter((entry) => entry.chatId === chatId);
    if (pendingForChat.length >= MAX_PENDING_PER_CHAT) {
      throw new Error(`Maximum pending pairings reached for chat ${chatId}`);
    }

    const now = Date.now();
    const newEntry: PairingEntry = {
      code: createUniqueCode(entries),
      chatId,
      userId,
      username: username ?? undefined,
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
    };
    entries.push(newEntry);
    dirty = true;

    if (dirty) {
      await writeStore(entries);
    }

    return newEntry.code;
  });
}

export async function getPendingPairings(): Promise<PairingEntry[]> {
  return withLock(async () => {
    let entries = await readStore();
    const pruneResult = pruneExpired(entries);
    entries = pruneResult.entries;
    if (pruneResult.removed) {
      await writeStore(entries);
    }
    return entries;
  });
}

export async function approvePairing(code: string): Promise<PairingEntry | null> {
  return withLock(async () => {
    let entries = await readStore();
    let dirty = false;

    const pruneResult = pruneExpired(entries);
    entries = pruneResult.entries;
    if (pruneResult.removed) {
      dirty = true;
    }

    const index = entries.findIndex((entry) => entry.code === code.toUpperCase());
    if (index === -1) {
      if (dirty) {
        await writeStore(entries);
      }
      return null;
    }

    const [approved] = entries.splice(index, 1);
    dirty = true;
    await writeStore(entries);
    return approved;
  });
}

export async function rejectPairing(code: string): Promise<boolean> {
  return withLock(async () => {
    let entries = await readStore();
    let dirty = false;

    const pruneResult = pruneExpired(entries);
    entries = pruneResult.entries;
    if (pruneResult.removed) {
      dirty = true;
    }

    const index = entries.findIndex((entry) => entry.code === code.toUpperCase());
    if (index === -1) {
      if (dirty) {
        await writeStore(entries);
      }
      return false;
    }

    entries.splice(index, 1);
    dirty = true;
    await writeStore(entries);
    return true;
  });
}

export async function cleanExpired(): Promise<void> {
  await withLock(async () => {
    const entries = await readStore();
    const pruneResult = pruneExpired(entries);
    if (pruneResult.removed) {
      await writeStore(pruneResult.entries);
    }
  });
}

async function readStore(): Promise<PairingEntry[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PairingStoreFile> | PairingEntry[];
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.pairings)
        ? parsed.pairings
        : [];

    return candidates
      .map(normalizeEntry)
      .filter((entry): entry is PairingEntry => entry !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeStore(entries: PairingEntry[]): Promise<void> {
  await ensureStoreDir();
  const tmpPath = `${STORE_FILE}.tmp`;
  const payload: PairingStoreFile = { pairings: entries };

  const handle = await fs.open(tmpPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    await handle.close();
  }

  await fs.rename(tmpPath, STORE_FILE);
  await fs.chmod(STORE_FILE, 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}

function pruneExpired(entries: PairingEntry[]): { entries: PairingEntry[]; removed: boolean } {
  const now = Date.now();
  const filtered = entries.filter((entry) => entry.expiresAt > now);
  return {
    entries: filtered,
    removed: filtered.length !== entries.length,
  };
}

function createUniqueCode(entries: PairingEntry[]): string {
  const existing = new Set(entries.map((entry) => entry.code));
  while (true) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      const index = crypto.randomInt(0, CODE_CHARSET.length);
      code += CODE_CHARSET[index];
    }
    if (!existing.has(code)) {
      return code;
    }
  }
}

function normalizeEntry(value: unknown): PairingEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Partial<PairingEntry>;
  if (
    typeof entry.code !== 'string' ||
    typeof entry.chatId !== 'string' ||
    typeof entry.userId !== 'string' ||
    typeof entry.createdAt !== 'number' ||
    typeof entry.expiresAt !== 'number'
  ) {
    return null;
  }

  return {
    code: entry.code.toUpperCase(),
    chatId: entry.chatId,
    userId: entry.userId,
    username: typeof entry.username === 'string' ? entry.username : undefined,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
}

async function withLock<T>(handler: () => Promise<T>): Promise<T> {
  await ensureStoreDir();
  const lockHandle = await acquireLock();
  try {
    return await handler();
  } finally {
    await releaseLock(lockHandle);
  }
}

async function acquireLock(): Promise<FileHandle> {
  const start = Date.now();
  while (true) {
    try {
      const handle = await fs.open(LOCK_FILE, 'wx', 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`,
        );
        return handle;
      } catch (writeError) {
        await handle.close().catch(() => {});
        await fs.unlink(LOCK_FILE).catch(() => {});
        throw writeError;
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        const lockOwnerPid = await readLockOwnerPid();
        const lockOwnedByDeadProcess =
          lockOwnerPid !== null && !isProcessRunning(lockOwnerPid);
        const lockWithoutOwnerButStale =
          lockOwnerPid === null && (await isLockFileStale());

        if (lockOwnedByDeadProcess || lockWithoutOwnerButStale) {
          let removed = false;
          try {
            await fs.unlink(LOCK_FILE);
            removed = true;
          } catch (unlinkError) {
            const code = (unlinkError as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
              removed = true;
            } else if (code !== 'EBUSY' && code !== 'EPERM') {
              throw unlinkError;
            }
          }
          if (removed) {
            continue;
          }
        }
        if (Date.now() - start > LOCK_TIMEOUT_MS) {
          throw new Error('Timed out acquiring pairing store lock');
        }
        await delay(LOCK_RETRY_DELAY_MS);
        continue;
      }
      if (err.code === 'ENOENT') {
        await ensureStoreDir();
        continue;
      }
      throw err;
    }
  }
}

async function readLockOwnerPid(): Promise<number | null> {
  try {
    const raw = await fs.readFile(LOCK_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      return parsed.pid;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

async function releaseLock(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } finally {
    await removeLockFile();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isLockFileStale(): Promise<boolean> {
  try {
    const stats = await fs.stat(LOCK_FILE);
    return Date.now() - stats.mtimeMs > LOCK_TIMEOUT_MS;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function removeLockFile(): Promise<void> {
  await fs.unlink(LOCK_FILE).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}
