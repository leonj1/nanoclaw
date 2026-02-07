import { isAllowed, isChatAllowed } from './allowlist-store.js';
import { upsertPairingRequest } from './pairing-store.js';
import { formatTelegramHandle } from './targets.js';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface AccessConfig {
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  allowFrom?: string[];
  groupAllowFrom?: string[];
}

export interface AccessResult {
  allowed: boolean;
  reason: string;
  pairingCode?: string;
}

/**
 * Evaluate DM policy for a Telegram user.
 */
export async function checkDmAccess(
  userId: string,
  username: string | undefined,
  config: AccessConfig,
): Promise<AccessResult> {
  switch (config.dmPolicy) {
    case 'disabled':
      return {
        allowed: false,
        reason: 'DMs are disabled for this bot',
      };
    case 'open':
      return { allowed: true, reason: 'DM policy is open' };
    case 'allowlist':
      return (await isAllowed({ userId, username }, config.allowFrom))
        ? { allowed: true, reason: 'Sender is allowlisted' }
        : { allowed: false, reason: 'Sender is not allowlisted' };
    case 'pairing': {
      const alreadyAllowed = await isAllowed(
        { userId, username },
        config.allowFrom,
      );
      if (alreadyAllowed) {
        return { allowed: true, reason: 'Sender is allowlisted' };
      }
      // On Telegram, the DM chat ID equals the sender ID, so reuse userId.
      const pairingRequest = await upsertPairingRequest(userId, username, userId);
      return {
        allowed: false,
        reason: 'Sender must complete pairing',
        pairingCode: pairingRequest.code,
      };
    }
    default:
      return {
        allowed: false,
        reason: `Unknown DM policy: ${config.dmPolicy}`,
      };
  }
}

/**
 * Evaluate group policy for a Telegram chat.
 */
export async function checkGroupAccess(
  chatId: string,
  config: AccessConfig,
): Promise<AccessResult> {
  switch (config.groupPolicy) {
    case 'disabled':
      return {
        allowed: false,
        reason: 'Group access is disabled for this bot',
      };
    case 'open':
      return { allowed: true, reason: 'Group policy is open' };
    case 'allowlist':
      return (await isChatAllowed(chatId, config.groupAllowFrom))
        ? { allowed: true, reason: 'Group chat is allowlisted' }
        : { allowed: false, reason: 'Group chat is not allowlisted' };
    default:
      return {
        allowed: false,
        reason: `Unknown group policy: ${config.groupPolicy}`,
      };
  }
}

/**
 * Produce a human-readable pairing prompt for unknown DM senders.
 */
export async function generatePairingResponse(
  userId: string,
  username: string | undefined,
  chatId: string,
): Promise<string> {
  const request = await upsertPairingRequest(userId, username, chatId);
  const handle = formatTelegramHandle(userId, username);
  return [
    `Hi ${handle}, this bot requires approval before new senders can DM.`,
    `Pairing code: ${request.code}`,
    'Ask the bot owner to approve you with:',
    `openclaw pairing approve telegram ${request.code}`,
    'Once approved, resend your message to continue.',
  ].join('\n');
}
