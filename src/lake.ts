import { parseBlock } from './parser.js';
import { getLastBlockHeight, setLastBlockHeight } from './db.js';

const NEARDATA_URL = process.env.NEARDATA_URL || 'https://mainnet.neardata.xyz/v0';
const POLL_INTERVAL_MS = 350;       // ~170 blocks/min, under 180/min rate limit
const CATCHUP_INTERVAL_MS = 50;     // faster polling when catching up (far from tip)
const IDLE_INTERVAL_MS = 1000;      // when at chain tip
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const CATCHUP_THRESHOLD = 100;      // blocks behind tip to consider "catching up"

let running = false;
let latestKnownHeight = 0;

async function fetchBlock(height: number): Promise<unknown | null> {
  const url = `${NEARDATA_URL}/block/${height}`;
  const res = await fetch(url);

  if (res.status === 200) {
    const text = await res.text();
    if (!text || text.length < 2) return null;
    try {
      const data = JSON.parse(text);
      // Rate limit error comes as JSON with "error" field
      if (data && data.error) return null;
      return data;
    } catch {
      return null;
    }
  }

  return null;
}

async function fetchLatestBlockHeight(): Promise<number> {
  try {
    const res = await fetch(`${NEARDATA_URL}/last_block/final`);
    if (!res.ok) return latestKnownHeight;
    const data = await res.json() as { block?: { header: { height: number } }; error?: string };
    if (data.error || !data.block) return latestKnownHeight;
    latestKnownHeight = data.block.header.height;
    return latestKnownHeight;
  } catch {
    return latestKnownHeight;
  }
}

async function fetchBlockWithRetry(height: number): Promise<unknown | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await fetchBlock(height);
      if (result !== null) return result;
      // Null result — could be rate limit or genuinely missing. Retry with backoff.
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
      }
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getStartBlockHeight(): Promise<number> {
  const saved = getLastBlockHeight();
  if (saved > 0) return saved + 1;

  const envStart = process.env.START_BLOCK;
  if (envStart && parseInt(envStart, 10) > 0) {
    return parseInt(envStart, 10);
  }

  const latest = await fetchLatestBlockHeight();
  console.log(`No saved state, starting from latest block: ${latest}`);
  return latest;
}

export async function startIndexing(): Promise<void> {
  if (running) return;
  running = true;

  let currentHeight = await getStartBlockHeight();
  latestKnownHeight = await fetchLatestBlockHeight();
  console.log(`Indexer starting from block ${currentHeight} (chain tip: ${latestKnownHeight})`);

  let totalEvents = 0;
  let blocksProcessed = 0;
  let skippedBlocks = 0;

  while (running) {
    try {
      if (blocksProcessed % 200 === 0) {
        latestKnownHeight = await fetchLatestBlockHeight();
      }

      const isAtTip = currentHeight > latestKnownHeight;

      if (isAtTip) {
        await sleep(IDLE_INTERVAL_MS);
        latestKnownHeight = await fetchLatestBlockHeight();
        continue;
      }

      const blockData = await fetchBlockWithRetry(currentHeight);

      if (blockData === null) {
        skippedBlocks++;
        setLastBlockHeight(currentHeight);
        currentHeight++;
        continue;
      }

      const eventsFound = parseBlock(blockData as Parameters<typeof parseBlock>[0]);

      if (eventsFound > 0) {
        totalEvents += eventsFound;
        console.log(`Block ${currentHeight}: ${eventsFound} events (total: ${totalEvents})`);
      }

      setLastBlockHeight(currentHeight);
      blocksProcessed++;

      if (blocksProcessed % 1000 === 0) {
        const behindBlocks = latestKnownHeight - currentHeight;
        console.log(`Progress: block ${currentHeight}, ${totalEvents} events, ${blocksProcessed} processed, ${skippedBlocks} skipped, ${behindBlocks} behind`);
      }

      currentHeight++;
      const behindBy = latestKnownHeight - currentHeight;
      await sleep(behindBy > CATCHUP_THRESHOLD ? CATCHUP_INTERVAL_MS : POLL_INTERVAL_MS);
    } catch (err) {
      console.error(`Error at block ${currentHeight}:`, err);
      await sleep(5000);
    }
  }
}

export function stopIndexing(): void {
  running = false;
  console.log('Indexer stopping...');
}
