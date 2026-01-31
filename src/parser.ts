import type { WhisperEvent, MessageSentEvent, MessageSentWithPaymentEvent, KeyRegisteredEvent } from './types.js';
import { saveMessage, saveProfile } from './db.js';

const CONTRACT_ID = process.env.CONTRACT_ID || 'whisper.kaizap.near';

// Matches actual neardata.xyz block structure
interface ReceiptExecutionOutcome {
  execution_outcome: {
    id: string;
    outcome: {
      executor_id: string;
      logs: string[];
      receipt_ids: string[];
      status: Record<string, unknown>;
    };
  };
  receipt: Record<string, unknown>;
  tx_hash: string;
}

interface NearBlock {
  block: {
    header: {
      height: number;
      timestamp: number; // nanoseconds
      hash: string;
    };
  };
  shards: Array<{
    shard_id: number;
    chunk?: Record<string, unknown>;
    receipt_execution_outcomes: ReceiptExecutionOutcome[];
    state_changes?: unknown[];
  }>;
}

export function parseBlock(blockData: NearBlock): number {
  const blockHeight = blockData.block.header.height;
  const timestampNs = String(blockData.block.header.timestamp);
  let eventsFound = 0;

  for (const shard of blockData.shards) {
    if (!shard.receipt_execution_outcomes?.length) continue;

    for (const reo of shard.receipt_execution_outcomes) {
      const executorId = reo.execution_outcome.outcome.executor_id;
      if (executorId !== CONTRACT_ID) continue;

      const logs = reo.execution_outcome.outcome.logs;
      if (!logs.length) continue;

      for (const log of logs) {
        if (!log.startsWith('EVENT_JSON:')) continue;

        try {
          const event: WhisperEvent = JSON.parse(log.slice('EVENT_JSON:'.length));
          if (event.standard !== 'whisper') continue;

          const txHash = reo.tx_hash || reo.execution_outcome.id;

          for (const item of event.data) {
            switch (event.event) {
              case 'message_sent': {
                const d = item as unknown as MessageSentEvent;
                saveMessage({
                  tx_hash: txHash,
                  block_height: blockHeight,
                  timestamp_ns: timestampNs,
                  event_type: 'message_sent',
                  sender: d.from,
                  recipient: d.to,
                  encrypted_body: d.encrypted_body,
                  nonce: d.nonce,
                  recipient_key_version: d.recipient_key_version,
                  reply_to: d.reply_to ?? null,
                  amount: null,
                });
                eventsFound++;
                break;
              }

              case 'message_sent_with_payment': {
                const d = item as unknown as MessageSentWithPaymentEvent;
                saveMessage({
                  tx_hash: txHash,
                  block_height: blockHeight,
                  timestamp_ns: timestampNs,
                  event_type: 'message_sent_with_payment',
                  sender: d.from,
                  recipient: d.to,
                  encrypted_body: d.encrypted_body,
                  nonce: d.nonce,
                  recipient_key_version: d.recipient_key_version,
                  reply_to: d.reply_to ?? null,
                  amount: d.amount,
                });
                eventsFound++;
                break;
              }

              case 'key_registered': {
                const d = item as unknown as KeyRegisteredEvent;
                saveProfile({
                  account_id: d.account_id,
                  x25519_pubkey: d.x25519_pubkey,
                  key_version: d.key_version,
                  display_name: d.display_name ?? null,
                  registered_at: timestampNs,
                });
                eventsFound++;
                break;
              }
            }
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  }

  return eventsFound;
}
