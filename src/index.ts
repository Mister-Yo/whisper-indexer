import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  getMessages,
  getConversations,
  getProfile,
  searchProfiles,
  getLastBlockHeight,
} from './db.js';
import { startIndexing, stopIndexing } from './lake.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = express();

app.use(cors());
app.use(express.json());

// GET /messages?account={id}&with={peer}&after={cursor}&limit=50
app.get('/messages', (req, res) => {
  const account = req.query.account as string;
  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }

  const peer = req.query.with as string | undefined;
  const after = req.query.after ? parseInt(req.query.after as string, 10) : undefined;
  const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 200) : 50;

  const messages = getMessages(account, peer, after, limit);
  res.json(messages);
});

// GET /messages/conversations?account={id}
app.get('/messages/conversations', (req, res) => {
  const account = req.query.account as string;
  if (!account) {
    res.status(400).json({ error: 'account is required' });
    return;
  }

  const conversations = getConversations(account);
  res.json(conversations);
});

// GET /profiles/:accountId
app.get('/profiles/search', (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    res.status(400).json({ error: 'q is required' });
    return;
  }

  const profiles = searchProfiles(query);
  res.json(profiles);
});

// GET /profiles/:accountId — must be after /profiles/search to avoid route conflict
app.get('/profiles/:accountId', (req, res) => {
  const profile = getProfile(req.params.accountId);
  if (!profile) {
    res.status(404).json({ error: 'profile not found' });
    return;
  }
  res.json(profile);
});

// GET /health
app.get('/health', (_req, res) => {
  const lastBlock = getLastBlockHeight();
  res.json({
    ok: true,
    lastBlock,
    uptime: process.uptime(),
  });
});

// Start server and indexer
const server = app.listen(PORT, () => {
  console.log(`Whisper indexer API running on http://localhost:${PORT}`);
  startIndexing();
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  stopIndexing();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
