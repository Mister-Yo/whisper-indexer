import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DbMessage, DbProfile } from './types.js';

const DB_PATH = process.env.DB_PATH || './data/whisper.db';

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    timestamp_ns TEXT NOT NULL,
    event_type TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    encrypted_body TEXT NOT NULL,
    nonce TEXT NOT NULL,
    recipient_key_version INTEGER NOT NULL,
    reply_to TEXT,
    amount TEXT,
    UNIQUE(tx_hash, event_type, sender, recipient)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    account_id TEXT PRIMARY KEY,
    x25519_pubkey TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    display_name TEXT,
    registered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
  CREATE INDEX IF NOT EXISTS idx_messages_block_height ON messages(block_height);
`);

// Prepared statements
const insertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages (tx_hash, block_height, timestamp_ns, event_type, sender, recipient, encrypted_body, nonce, recipient_key_version, reply_to, amount)
  VALUES (@tx_hash, @block_height, @timestamp_ns, @event_type, @sender, @recipient, @encrypted_body, @nonce, @recipient_key_version, @reply_to, @amount)
`);

const upsertProfile = db.prepare(`
  INSERT INTO profiles (account_id, x25519_pubkey, key_version, display_name, registered_at)
  VALUES (@account_id, @x25519_pubkey, @key_version, @display_name, @registered_at)
  ON CONFLICT(account_id) DO UPDATE SET
    x25519_pubkey = excluded.x25519_pubkey,
    key_version = excluded.key_version,
    display_name = excluded.display_name
`);

const getSyncState = db.prepare('SELECT value FROM sync_state WHERE key = ?');
const setSyncState = db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)');

export function getLastBlockHeight(): number {
  const row = getSyncState.get('last_block_height') as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

export function setLastBlockHeight(height: number): void {
  setSyncState.run('last_block_height', String(height));
}

export function saveMessage(msg: Omit<DbMessage, 'id'>): void {
  insertMessage.run(msg);
}

export function saveProfile(profile: DbProfile): void {
  upsertProfile.run(profile);
}

// Query: messages between account and peer
export function getMessages(account: string, peer?: string, after?: number, limit = 50): DbMessage[] {
  if (peer) {
    return db.prepare(`
      SELECT * FROM messages
      WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
      ${after ? 'AND id > ?' : ''}
      ORDER BY block_height ASC, id ASC
      LIMIT ?
    `).all(
      ...(after
        ? [account, peer, peer, account, after, limit]
        : [account, peer, peer, account, limit])
    ) as DbMessage[];
  }

  return db.prepare(`
    SELECT * FROM messages
    WHERE sender = ? OR recipient = ?
    ${after ? 'AND id > ?' : ''}
    ORDER BY block_height DESC, id DESC
    LIMIT ?
  `).all(
    ...(after
      ? [account, account, after, limit]
      : [account, account, limit])
  ) as DbMessage[];
}

// Query: conversations list
export function getConversations(account: string) {
  const rows = db.prepare(`
    SELECT
      CASE WHEN sender = ? THEN recipient ELSE sender END AS peer,
      MAX(timestamp_ns) AS last_message_at,
      encrypted_body AS last_message_preview,
      COUNT(*) AS total_count
    FROM messages
    WHERE sender = ? OR recipient = ?
    GROUP BY peer
    ORDER BY last_message_at DESC
  `).all(account, account, account) as Array<{
    peer: string;
    last_message_at: string;
    last_message_preview: string;
    total_count: number;
  }>;

  return rows.map((r) => ({
    peer: r.peer,
    last_message_at: r.last_message_at,
    last_message_preview: r.last_message_preview,
    unread_count: 0, // TODO: track read status
  }));
}

// Query: get profile
export function getProfile(accountId: string): DbProfile | undefined {
  return db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId) as DbProfile | undefined;
}

// Query: search profiles
export function searchProfiles(query: string): DbProfile[] {
  return db.prepare(
    'SELECT * FROM profiles WHERE account_id LIKE ? OR display_name LIKE ? LIMIT 20'
  ).all(`%${query}%`, `%${query}%`) as DbProfile[];
}

export { db };
