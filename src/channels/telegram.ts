import { Bot, GrammyError, HttpError, type Context } from 'grammy';
import type { Message, MessageEntity, UserFromGetMe } from 'grammy/types';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { apiThrottler } from '@grammyjs/transformer-throttler';

import { logger } from '../logger.js';
import {
  type ChannelSendOptions,
  type ConnectionChangeHandler,
  type ConnectionState,
  type GroupMetadata,
  type MessageChannel,
  type MessageHandler,
  type NormalizedAttachment,
  type NormalizedMessage,
} from './types.js';
import { TelegramAccessController } from '../telegram/access.js';
import { renderHtmlMessage } from '../telegram/format.js';
import { isHtmlParseError, isRetryableTelegramError } from '../telegram/network-errors.js';
import { probeTelegramBot } from '../telegram/probe.js';
import { resolveTelegramTarget, createAttachmentPlaceholder } from '../telegram/targets.js';
import type { TelegramChannelConfig } from '../telegram/types.js';
import { resolveTelegramToken } from '../telegram/token.js';

const DEFAULT_CONCURRENCY = 32;
const TYPING_ACTION = 'typing';

export class TelegramChannel implements MessageChannel {
  public readonly name = 'telegram';
  public state: ConnectionState = 'disconnected';

  private readonly bot: Bot;
  private readonly config: TelegramChannelConfig;
  private readonly access: TelegramAccessController;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly connectionHandlers = new Set<ConnectionChangeHandler>();
  private runner?: RunnerHandle;
  private botProfile?: UserFromGetMe;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    const token = resolveTelegramToken(config);
    this.bot = new Bot(token);
    const maxRequestsPerSecond = config.rateLimit?.maxRequestsPerSecond;
    const minTime = maxRequestsPerSecond
      ? Math.ceil(1000 / maxRequestsPerSecond)
      : undefined;
    this.bot.api.config.use(
      apiThrottler({
        global: {
          maxConcurrent: config.rateLimit?.maxBurst ?? 10,
          minTime,
        },
      }),
    );

    this.access = new TelegramAccessController(config);
    this.registerBotHandlers();
  }

  public async connect(): Promise<void> {
    if (this.runner?.isRunning()) {
      return;
    }

    this.updateState('connecting');
    try {
      this.botProfile = await probeTelegramBot(this.bot);
      this.access.setBotUsername(this.botProfile.username ?? undefined);
    } catch (error) {
      this.updateState('error');
      throw error;
    }

    this.runner = run(this.bot, {
      sink: { concurrency: this.config.runner?.concurrency ?? DEFAULT_CONCURRENCY },
    });
    this.updateState('connected');
  }

  public async disconnect(): Promise<void> {
    if (!this.runner) {
      this.updateState('disconnected');
      return;
    }

    try {
      await this.runner.stop();
    } finally {
      this.runner = undefined;
      this.updateState('disconnected');
    }
  }

  public async sendMessage(
    chatId: string,
    text: string,
    options?: ChannelSendOptions,
  ): Promise<void> {
    const target = resolveTelegramTarget(chatId);
    try {
      await this.bot.api.sendMessage(
        target.chatId,
        renderHtmlMessage(text),
        this.buildSendOptions(options, target.threadId),
      );
    } catch (error) {
      if (isHtmlParseError(error)) {
        logger.debug({ chatId: target.chatId, error }, 'HTML parse failed, retrying without parse mode');
        await this.bot.api.sendMessage(
          target.chatId,
          text,
          this.buildSendOptions({ ...options, parseMode: 'None' }, target.threadId),
        );
        return;
      }

      if (isRetryableTelegramError(error)) {
        logger.warn({ error, chatId: target.chatId }, 'Retryable Telegram send error');
      }
      throw error;
    }
  }

  public onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }

  public onConnectionChange(handler: ConnectionChangeHandler): void {
    this.connectionHandlers.add(handler);
  }

  public async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!isTyping) {
      return;
    }

    const target = resolveTelegramTarget(chatId);
    try {
      await this.bot.api.sendChatAction(target.chatId, TYPING_ACTION);
    } catch (error) {
      logger.debug({ error, chatId: target.chatId }, 'Failed to send typing indicator');
    }
  }

  public async getGroupMetadata(chatId: string): Promise<GroupMetadata | null> {
    try {
      const chat = await this.bot.api.getChat(chatId);
      return {
        id: String(chat.id),
        type: chat.type,
        title: chat.title ?? chat.username ?? String(chat.id),
        description: 'description' in chat ? chat.description ?? null : null,
        memberCount: undefined,
        inviteLink: 'invite_link' in chat ? chat.invite_link ?? null : null,
      };
    } catch (error) {
      if (error instanceof GrammyError || error instanceof HttpError) {
        logger.debug({ error, chatId }, 'Failed to load chat metadata');
        return null;
      }
      throw error;
    }
  }

  public async fetchAllGroups(): Promise<GroupMetadata[]> {
    return [];
  }

  private registerBotHandlers(): void {
    this.bot.catch((err) => {
      logger.error({ err }, 'Telegram bot error');
      this.updateState('error');
      throw err;
    });

    this.bot.on('message', (ctx) => {
      void this.handleIncomingMessage(ctx);
    });
  }

  private async handleIncomingMessage(ctx: Context): Promise<void> {
    if (!ctx.message || !ctx.chat) {
      return;
    }

    const normalized = this.normalizeMessage(ctx.message, ctx);
    const decision = this.access.evaluate(normalized);
    if (!decision.allowed) {
      logger.debug({ reason: decision.reason }, 'Telegram message blocked by access policy');
      return;
    }

    await this.emitMessage(normalized);
  }

  private normalizeMessage(message: Message, ctx: Context): NormalizedMessage {
    const attachments = this.extractAttachments(message);
    const baseText = this.extractMessageText(message);
    const placeholderText = attachments.map((attachment) => attachment.placeholder);
    const combinedText = [baseText, ...placeholderText].filter(Boolean).join('\n');
    const chatType = ctx.chat!.type;
    const sender = message.from;

    return {
      id: String(message.message_id),
      chatId: String(ctx.chat!.id ?? message.chat.id),
      chatType,
      senderId: sender ? String(sender.id) : 'system',
      senderName: sender
        ? [sender.first_name, sender.last_name].filter(Boolean).join(' ').trim() || undefined
        : undefined,
      senderUsername: sender?.username,
      text: combinedText || placeholderText.join('\n') || '',
      timestamp: message.date * 1000,
      attachments,
      replyToMessageId: message.reply_to_message
        ? String(message.reply_to_message.message_id)
        : undefined,
      threadId: (message as { message_thread_id?: number }).message_thread_id,
      mentions: this.extractMentions(message),
      raw: message,
    };
  }

  private extractAttachments(message: Message): NormalizedAttachment[] {
    const attachments: NormalizedAttachment[] = [];

    if ('photo' in message && Array.isArray(message.photo) && message.photo.length) {
      const photo = message.photo[message.photo.length - 1];
      attachments.push({
        type: 'photo',
        placeholder: createAttachmentPlaceholder('photo'),
        fileId: photo.file_id,
        size: photo.file_size,
      });
    }

    if ('document' in message && message.document) {
      attachments.push({
        type: 'document',
        placeholder: createAttachmentPlaceholder('document', message.document.file_name ?? undefined),
        fileId: message.document.file_id,
        mimeType: message.document.mime_type,
        fileName: message.document.file_name ?? undefined,
        size: message.document.file_size,
      });
    }

    if ('video' in message && message.video) {
      attachments.push({
        type: 'video',
        placeholder: createAttachmentPlaceholder('video'),
        fileId: message.video.file_id,
        duration: message.video.duration,
        mimeType: message.video.mime_type,
        size: message.video.file_size,
      });
    }

    if ('audio' in message && message.audio) {
      attachments.push({
        type: 'audio',
        placeholder: createAttachmentPlaceholder('audio', message.audio.title ?? undefined),
        fileId: message.audio.file_id,
        duration: message.audio.duration,
        mimeType: message.audio.mime_type,
        fileName: message.audio.file_name ?? undefined,
        size: message.audio.file_size,
      });
    }

    if ('voice' in message && message.voice) {
      attachments.push({
        type: 'voice',
        placeholder: createAttachmentPlaceholder('voice'),
        fileId: message.voice.file_id,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type,
        size: message.voice.file_size,
      });
    }

    if ('sticker' in message && message.sticker) {
      attachments.push({
        type: 'sticker',
        placeholder: createAttachmentPlaceholder('sticker', message.sticker.emoji ?? undefined),
        fileId: message.sticker.file_id,
      });
    }

    if ('animation' in message && message.animation) {
      attachments.push({
        type: 'animation',
        placeholder: createAttachmentPlaceholder('animation'),
        fileId: message.animation.file_id,
        duration: message.animation.duration,
        mimeType: message.animation.mime_type,
        size: message.animation.file_size,
      });
    }

    return attachments;
  }

  private extractMessageText(message: Message): string {
    if ('text' in message && message.text) {
      return message.text;
    }

    if ('caption' in message && message.caption) {
      return message.caption;
    }

    return '';
  }

  private extractMentions(message: Message): string[] {
    const mentions = new Set<string>();
    const textMentions = this.collectMentions(
      'text' in message ? message.text ?? '' : '',
      'entities' in message ? message.entities : undefined,
    );
    textMentions.forEach((mention) => mentions.add(mention));

    const captionMentions = this.collectMentions(
      'caption' in message ? message.caption ?? '' : '',
      'caption_entities' in message ? message.caption_entities : undefined,
    );
    captionMentions.forEach((mention) => mentions.add(mention));

    return Array.from(mentions);
  }

  private collectMentions(text: string, entities?: ReadonlyArray<MessageEntity>): string[] {
    if (!entities?.length) {
      return [];
    }

    const mentions: string[] = [];
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mention = text
          .slice(entity.offset, entity.offset + entity.length)
          .replace(/^@/, '')
          .toLowerCase();
        if (mention) {
          mentions.push(mention);
        }
      }
      if (entity.type === 'text_mention' && entity.user?.username) {
        mentions.push(entity.user.username.toLowerCase());
      }
    }
    return mentions;
  }

  private async emitMessage(message: NormalizedMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        logger.error({ error }, 'Telegram message handler failed');
      }
    }
  }

  private updateState(nextState: ConnectionState): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    for (const handler of this.connectionHandlers) {
      try {
        handler(nextState);
      } catch (error) {
        logger.error({ error }, 'Telegram connection handler failed');
      }
    }
  }

  private buildSendOptions(
    options: ChannelSendOptions | undefined,
    threadId?: number,
  ) {
    const parseMode = options?.parseMode ?? 'HTML';
    return {
      parse_mode: parseMode === 'None' ? undefined : parseMode,
      reply_to_message_id: options?.replyToMessageId,
      message_thread_id: options?.threadId ?? threadId,
      disable_notification: options?.disableNotification,
      disable_web_page_preview: options?.linkPreview === false || undefined,
    };
  }
}
