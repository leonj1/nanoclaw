---
summary: "Internal Telegram flow: registration, authentication/authorization, and request/response handling"
read_when:
  - You need to understand Telegram internals in OpenClaw
  - You are debugging Telegram onboarding, pairing, or reply behavior
title: "Telegram Internal Flow"
---

# Telegram Internal Flow (Registration, Auth, Request/Response)

This document explains how Telegram works internally in `./tmp/openclaw`, from setup to runtime message handling.

## Scope

- Channel: Telegram (`extensions/telegram`)
- Runtime: Gateway + plugin runtime
- Focus:
  - Registration/setup
  - Authentication and authorization
  - Inbound request to outbound response flow

## 1) Registration (Bot Setup)

OpenClaw does not create Telegram bots for you. You create a bot in Telegram (`@BotFather`) and give OpenClaw the token.

Primary setup paths:

1. Interactive onboarding adapter:
   - `tmp/openclaw/src/channels/plugins/onboarding/telegram.ts`
2. CLI add flow:
   - `openclaw channels add --channel telegram --token ...`
   - `tmp/openclaw/src/cli/channels-cli.ts`
   - `tmp/openclaw/src/commands/channels/add.ts`
3. Plugin setup mutator:
   - `tmp/openclaw/extensions/telegram/src/channel.ts`

Important setup behavior:

- Default account can use `--use-env` (`TELEGRAM_BOT_TOKEN`).
- Non-default Telegram accounts must use explicit token/tokenFile.
- Setup writes config under:
  - `channels.telegram.botToken` / `channels.telegram.tokenFile` (default account)
  - `channels.telegram.accounts.<id>.botToken` / `tokenFile` (named account)

## 2) Token Resolution and Channel Start

Resolved by:

- `tmp/openclaw/src/telegram/token.ts`

Resolution order (per account):

1. Account `tokenFile`
2. Account `botToken`
3. Default-account top-level `tokenFile`
4. Default-account top-level `botToken`
5. `TELEGRAM_BOT_TOKEN` (default account only)

Start path:

- Plugin gateway entrypoint: `tmp/openclaw/extensions/telegram/src/channel.ts` (`gateway.startAccount`)
- Monitor: `tmp/openclaw/src/telegram/monitor.ts`
- Bot creation: `tmp/openclaw/src/telegram/bot.ts`

If no token is resolved, startup fails with a token-missing error.

## 3) Telegram-Side Auth vs Sender Auth

There are two different auth layers:

1. Bot authentication to Telegram API:
   - The bot token authenticates OpenClaw to Telegram Bot API.
   - Health/probe uses `getMe`:
     - `tmp/openclaw/src/telegram/probe.ts`
2. Sender authorization inside OpenClaw:
   - Determines which Telegram users/chats may interact with the agent.
   - Enforced by DM policy, allowlists, pairing, and group policy.

## 4) DM Authentication/Authorization (Pairing + Allowlist)

Core logic:

- `tmp/openclaw/src/telegram/bot-message-context.ts`
- `tmp/openclaw/src/telegram/bot-access.ts`

DM policy (`channels.telegram.dmPolicy`, default effectively `pairing` in runtime):

- `pairing`: unknown DM sender gets pairing code and message is blocked.
- `allowlist`: only configured/paired users are allowed.
- `open`: allow all (schema requires `allowFrom` to include `"*"`).
- `disabled`: ignore DMs.

Schema checks:

- `tmp/openclaw/src/config/zod-schema.providers-core.ts`

Pairing lifecycle:

1. Unknown DM sender triggers `upsertChannelPairingRequest(...)`.
2. Code is sent back with:
   - Telegram user ID
   - approval command: `openclaw pairing approve telegram <code>`
3. Owner approves via CLI:
   - `tmp/openclaw/src/cli/pairing-cli.ts`
4. Approval writes sender ID into channel allow store:
   - `tmp/openclaw/src/pairing/pairing-store.ts`

Pairing store details:

- Code length: 8 chars
- TTL: 1 hour
- Max pending per channel: 3
- Files are stored in credentials dir:
  - default: `~/.nanoclaw/credentials/telegram-pairing.json`
  - default: `~/.nanoclaw/credentials/telegram-allowFrom.json`

Path resolution:

- `tmp/openclaw/src/config/paths.ts`
- `tmp/openclaw/src/pairing/pairing-store.ts`

Normalization rules:

- `telegram:` / `tg:` prefixes are stripped before allowlist matching.
- Username matching is case-insensitive.
- `*` wildcard is supported.

## 5) Group Authorization

Group filtering combines:

- Group policy (`open` / `allowlist` / `disabled`)
- Group allowlists (`groupAllowFrom`, `groups.<chatId>.allowFrom`, topic override)
- Group ID allowlist (`channels.telegram.groups`)
- Mention gating (`requireMention`)

Key handler:

- `tmp/openclaw/src/telegram/bot-handlers.ts`

## 6) Request -> Response Flow (Runtime)

### Inbound

1. Account starts in polling or webhook mode:
   - Polling by default (`monitorTelegramProvider`)
   - Webhook when `webhookUrl` configured (`startTelegramWebhook`)
2. Bot registers handlers:
   - `registerTelegramHandlers(...)`
3. On message:
   - Load paired allow entries from store
   - Apply DM/group authorization
   - Build normalized message context (envelope, reply context, media placeholders, routing keys)
   - Route to target agent/session

Main files:

- `tmp/openclaw/src/telegram/monitor.ts`
- `tmp/openclaw/src/telegram/webhook.ts`
- `tmp/openclaw/src/telegram/bot.ts`
- `tmp/openclaw/src/telegram/bot-handlers.ts`
- `tmp/openclaw/src/telegram/bot-message-context.ts`

### Agent processing

Processed through the shared auto-reply pipeline after Telegram normalization/routing.

### Outbound response

Telegram send path:

- `tmp/openclaw/src/telegram/send.ts`

Behavior highlights:

- Uses resolved account token (or explicit token override).
- Normalizes target IDs/usernames/t.me links.
- Supports thread and reply parameters.
- Uses retry policy for recoverable network errors.
- Markdown-like content is rendered to Telegram-safe HTML.
- On parse-mode failures, fallback to plain text is used.

## 7) Webhook Registration Details

When webhook mode is enabled:

1. OpenClaw starts local HTTP server.
2. Registers Telegram webhook with:
   - `setWebhook(publicUrl, { secret_token, allowed_updates })`
3. Verifies inbound webhook path and optional secret token through grammY webhook callback.

File:

- `tmp/openclaw/src/telegram/webhook.ts`

Related utility:

- `tmp/openclaw/src/telegram/webhook-set.ts`

## 8) `channels login` vs Telegram

`openclaw channels login` is generic and only works for channels implementing `plugin.auth.login`.
Telegram plugin does not implement this login interface, so Telegram is configured via token setup (`channels add`/onboarding), not QR login.

Relevant:

- `tmp/openclaw/src/cli/channel-auth.ts`
- `tmp/openclaw/extensions/telegram/src/channel.ts`

## 9) Quick Operational Checklist

1. Configure token (`channels add` or config/env).
2. Start gateway and check Telegram channel status/probe.
3. For first DM from unknown sender:
   - get pairing code
   - approve with `openclaw pairing approve telegram <code>`
4. Confirm sender entered allow store.
5. Send test message and verify outbound response in same chat/thread.
