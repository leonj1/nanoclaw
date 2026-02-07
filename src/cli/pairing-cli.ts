#!/usr/bin/env node

import process from 'process';

import {
  PairingExpiredError,
  PairingNotFoundError,
  PairingRequest,
  approvePairing,
  getPendingPairings,
  rejectPairing,
} from '../telegram/pairing-store.js';
import { addTelegramAllowEntry } from '../telegram/allowlist-store.js';

const SUPPORTED_CHANNELS = ['telegram'] as const;
type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

function usage(): void {
  const commands = `
Usage:
  nanoclaw pairing list <channel>
  nanoclaw pairing approve <channel> <code>
  nanoclaw pairing reject <channel> <code>

Example:
  nanoclaw pairing approve telegram F8A92C10
`;
  console.log(commands.trim());
}

function normalizeChannel(input?: string): SupportedChannel {
  if (!input) {
    throw new Error('Missing channel. Supported channels: telegram');
  }
  const normalized = input.toLowerCase();
  if (SUPPORTED_CHANNELS.includes(normalized as SupportedChannel)) {
    return normalized as SupportedChannel;
  }
  throw new Error(
    `Unsupported channel "${input}". Supported channels: ${SUPPORTED_CHANNELS.join(', ')}`,
  );
}

function formatUser(entry: Pick<PairingRequest, 'firstName' | 'lastName'>): string {
  const parts = [entry.firstName, entry.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Unknown';
}

function renderPairingTable(channel: SupportedChannel): void {
  const pairings = getPendingPairings(channel);
  if (pairings.length === 0) {
    console.log('No pending pairing requests.');
    return;
  }

  const rows = pairings.map((entry) => ({
    Code: entry.code,
    User: formatUser(entry),
    Username: entry.username ? `@${entry.username}` : '—',
    'Chat ID': entry.chatId,
    Expires: new Date(entry.expiresAt).toLocaleString(),
  }));

  console.table(rows);
}

function handlePairingError(err: unknown, code?: string): never {
  if (err instanceof PairingNotFoundError) {
    console.error(
      `Pairing code ${code ?? ''} was not found. Run "nanoclaw pairing list telegram" to see pending requests.`,
    );
    process.exit(1);
  }

  if (err instanceof PairingExpiredError) {
    const expires = new Date(err.entry.expiresAt).toLocaleString();
    console.error(
      `Pairing code ${err.entry.code} expired on ${expires}. Ask the user to request a new code.`,
    );
    process.exit(1);
  }

  if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error('Unknown error while processing pairing command.');
  }
  process.exit(1);
}

function approveCommand(channel: SupportedChannel, code?: string): void {
  if (!code) {
    console.error('Pairing approval requires a code.');
    usage();
    process.exit(1);
  }

  try {
    const pairing = approvePairing(code, channel);
    if (channel === 'telegram') {
      addTelegramAllowEntry({
        userId: pairing.userId,
        username: pairing.username,
        firstName: pairing.firstName,
        lastName: pairing.lastName,
        chatId: pairing.chatId,
      });
    }

    const username = pairing.username ? ` (@${pairing.username})` : '';
    console.log(
      `Approved ${channel} user ${formatUser(pairing)}${username}. Chat ID: ${pairing.chatId}.`,
    );
  } catch (err) {
    handlePairingError(err, code);
  }
}

function rejectCommand(channel: SupportedChannel, code?: string): void {
  if (!code) {
    console.error('Pairing rejection requires a code.');
    usage();
    process.exit(1);
  }

  try {
    rejectPairing(code, channel);
    console.log(`Rejected ${channel} pairing request ${code.toUpperCase()}.`);
  } catch (err) {
    handlePairingError(err, code);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  if (args[0] === 'pairing') {
    args.shift();
  }

  const [action, channelArg, code] = args;
  if (!action) {
    usage();
    process.exit(1);
  }

  let channel: SupportedChannel;
  try {
    channel = normalizeChannel(channelArg);
  } catch (err) {
    handlePairingError(err);
  }

  switch (action) {
    case 'list':
      renderPairingTable(channel);
      break;
    case 'approve':
      approveCommand(channel, code);
      break;
    case 'reject':
      rejectCommand(channel, code);
      break;
    default:
      console.error(`Unknown pairing subcommand "${action}".`);
      usage();
      process.exit(1);
  }
}

main();
