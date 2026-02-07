export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ChannelSendOptions {
  replyToMessageId?: number;
  threadId?: number;
  disableNotification?: boolean;
  parseMode?: 'HTML' | 'MarkdownV2' | 'None';
  linkPreview?: boolean;
}

export interface GroupMetadata {
  id: string;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title: string;
  description?: string | null;
  memberCount?: number;
  inviteLink?: string | null;
}

export interface NormalizedAttachment {
  type:
    | 'photo'
    | 'video'
    | 'audio'
    | 'voice'
    | 'document'
    | 'animation'
    | 'sticker'
    | 'unknown';
  placeholder: string;
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  duration?: number;
}

export interface NormalizedMessage {
  id: string;
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  text: string;
  timestamp: number;
  attachments: NormalizedAttachment[];
  replyToMessageId?: string;
  threadId?: number;
  mentions: string[];
  raw: unknown;
}

export type MessageHandler = (message: NormalizedMessage) => void | Promise<void>;
export type ConnectionChangeHandler =
  (state: ConnectionState) => void | Promise<void>;

export interface MessageChannel {
  readonly name: string;
  state: ConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(
    chatId: string,
    text: string,
    options?: ChannelSendOptions,
  ): Promise<void>;
  onMessage(handler: MessageHandler): void;
  onConnectionChange(handler: ConnectionChangeHandler): void;
  setTyping(chatId: string, isTyping: boolean): Promise<void>;
  getGroupMetadata(chatId: string): Promise<GroupMetadata | null>;
  fetchAllGroups(): Promise<GroupMetadata[]>;
}
