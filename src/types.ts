// NEP-297 event types emitted by whisper.kaizap.near

export interface WhisperEvent {
  standard: 'whisper';
  version: string;
  event: string;
  data: Record<string, unknown>[];
}

export interface MessageSentEvent {
  from: string;
  to: string;
  encrypted_body: string;
  nonce: string;
  recipient_key_version: number;
  reply_to: string | null;
}

export interface MessageSentWithPaymentEvent extends MessageSentEvent {
  amount: string; // yoctoNEAR
}

export interface KeyRegisteredEvent {
  account_id: string;
  x25519_pubkey: string;
  key_version: number;
  display_name: string | null;
}

export interface GroupCreatedEvent {
  group_id: string;
  creator: string;
  name: string;
}

// Database row types
export interface DbMessage {
  id: number;
  tx_hash: string;
  block_height: number;
  timestamp_ns: string;
  event_type: string;
  sender: string;
  recipient: string;
  encrypted_body: string;
  nonce: string;
  recipient_key_version: number;
  reply_to: string | null;
  amount: string | null;
}

export interface DbProfile {
  account_id: string;
  x25519_pubkey: string;
  key_version: number;
  display_name: string | null;
  registered_at: string;
}
