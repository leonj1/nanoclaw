import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const FILE_MODE = 0o600;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;
const CREDENTIALS_DIR = path.join(os.homedir(), '.nanoclaw', 'credentials');
const ALLOWLIST_PATH = path.join(CREDENTIALS_DIR, 'telegram-allowFrom.json');
const LOCK_PATH = path.join(CREDENTIALS_DIR, 'telegram-allowFrom.lock');

export type AllowlistEntryType = 'id' | 'username' | 'wildcard';

export interface AllowlistEntry {
  type: AllowlistEntryType;
  value: string;
}

export async function loadAllowlist(): Promise<AllowlistEntry[]> {
  return withFileLock(async () => readAllowlistFile());
}

export async function saveAllowlist(entries: AllowlistEntry[]): Promise<void> {
  if (!Array.isArray(entries)) {
    throw new Error('Allowlist entries must be an array');
  }

  const normalized = entries.map((entry) => normalizeExistingEntry(entry));

  await withFileLock(async () => writeAllowlistFile(normalized));
}

export async function isAllowed(userId: string, username?: string): Promise<boolean> {
  const normalizedUserId = (userId ?? '').trim();
  const normalizedUsername = normalizeUsername(username);

  const entries = await withFileLock(async () => readAllowlistFile());
  if (!entries.length) {
    return false;
  }

  if (entries.some((entry) => entry.type === 'wildcard')) {
    return true;
  }

  if (normalizedUserId && entries.some((entry) => entry.type === 'id' && entry.value === normalizedUserId)) {
    return true;
  }

  if (
    normalizedUsername &&
    entries.some((entry) => entry.type === 'username' && entry.value === normalizedUsername)
  ) {
    return true;
  }

  return false;
}

export async function addToAllowlist(entry: string | number): Promise<void> {
  const parsedEntry = parseAllowlistInput(entry);

  await withFileLock(async () => {
    const entries = await readAllowlistFile();
    const exists = entries.some((existing) => entriesEqual(existing, parsedEntry));
    if (exists) {
      return;
    }

    entries.push(parsedEntry);
    await writeAllowlistFile(entries);
  });
}

export async function removeFromAllowlist(entry: string | number): Promise<boolean> {
  const parsedEntry = parseAllowlistInput(entry);

  return withFileLock(async () => {
    const entries = await readAllowlistFile();
    const filtered = entries.filter((existing) => !entriesEqual(existing, parsedEntry));

    if (filtered.length === entries.length) {
      return false;
    }

    await writeAllowlistFile(filtered);
    return true;
  });
}

function normalizeExistingEntry(entry: AllowlistEntry): AllowlistEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Invalid allowlist entry');
  }

  switch (entry.type) {
    case 'wildcard':
      return { type: 'wildcard', value: '*' };
    case 'username': {
      const normalizedUsername = normalizeUsername(entry.value);
      if (!normalizedUsername) {
        throw new Error('Invalid username entry');
      }
      return { type: 'username', value: normalizedUsername };
    }
    case 'id': {
      const normalizedId = normalizeId(entry.value);
      if (!normalizedId) {
        throw new Error('Invalid id entry');
      }
      return { type: 'id', value: normalizedId };
    }
    default:
      throw new Error(`Unsupported entry type: ${(entry as AllowlistEntry).type}`);
  }
}

function parseAllowlistInput(entry: string | number): AllowlistEntry {
  if (typeof entry === 'number') {
    if (!Number.isFinite(entry)) {
      throw new Error('Numeric allowlist entry must be finite');
    }
    return { type: 'id', value: normalizeId(entry) };
  }

  const value = entry.trim();
  if (!value) {
    throw new Error('Allowlist entry cannot be empty');
  }

  if (value === '*') {
    return { type: 'wildcard', value: '*' };
  }

  if (/^\d+$/.test(value)) {
    return { type: 'id', value };
  }

  const normalizedUsername = normalizeUsername(value);
  if (normalizedUsername) {
    return { type: 'username', value: normalizedUsername };
  }

  throw new Error(`Invalid allowlist entry: ${entry}`);
}

function normalizeId(value: string | number): string {
  const text = typeof value === 'number' ? Math.trunc(value).toString() : value.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error('ID entries must contain only digits');
  }
  return text;
}

function normalizeUsername(value?: string): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!withoutPrefix) {
    return null;
  }
  return withoutPrefix.toLowerCase();
}

async function readAllowlistFile(): Promise<AllowlistEntry[]> {
  try {
    const raw = await fs.readFile(ALLOWLIST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const entries: AllowlistEntry[] = [];
    for (const entry of parsed) {
      try {
        entries.push(normalizeExistingEntry(entry));
      } catch {
        // Skip invalid entries
      }
    }
    return entries;
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeAllowlistFile(entries: AllowlistEntry[]): Promise<void> {
  await ensureCredentialsDir();
  const payload = `${JSON.stringify(entries, null, 2)}\n`;
  await fs.writeFile(ALLOWLIST_PATH, payload, { mode: FILE_MODE });
  await safeChmod(ALLOWLIST_PATH, FILE_MODE);
}

async function ensureCredentialsDir(): Promise<void> {
  await fs.mkdir(CREDENTIALS_DIR, { recursive: true });
}

function entriesEqual(a: AllowlistEntry, b: AllowlistEntry): boolean {
  return a.type === b.type && a.value === b.value;
}

async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireLock(): Promise<() => Promise<void>> {
  await ensureCredentialsDir();
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const handle = await fs.open(LOCK_PATH, 'wx', FILE_MODE);
      return async () => {
        await handle.close();
        await fs.unlink(LOCK_PATH).catch((error: any) => {
          if (!error || error.code !== 'ENOENT') {
            throw error;
          }
        });
      };
    } catch (error: any) {
      if (error && error.code === 'EEXIST') {
        if (Date.now() - start > LOCK_TIMEOUT_MS) {
          throw new Error('Timed out while waiting for allowlist lock');
        }
        await delay(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeChmod(targetPath: string, mode: number): Promise<void> {
  try {
    await fs.chmod(targetPath, mode);
  } catch (error: any) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}
