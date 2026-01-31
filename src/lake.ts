import { parseBlock } from './parser.js';
import { getLastBlockHeight, setLastBlockHeight } from './db.js';

const NEARDATA_URL = process.env.NEARDATA_URL || 'https://mainnet.neardata.xyz/v0';
const POLL_INTERVAL_MS = 50;        // between blocks when catching up
const IDLE_INTERVAL_MS = 1000;      // when at chain tip
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

let running = false;
let latestKnownHeight = 0;

async function fetchBlock(height: number): Promise<unknown | null> {
  const url = `${NEARDATA_URL}/block/${height}`;
  const res = await fetch(url);

  if (res.status === 200) {
    return await res.json();
  }

  // Block not available — either skipped or not yet produced
  return null;
}

async function fetchLatestBlockHeight(): Promise<number> {
  try {
    const res = await fetch(`${NEARDATA_URL}/last_block/final`);
    if (!res.ok) return latestKnownHeight;
    const data = await res.json() as { block: { header: { height: number } } };
    latestKnownHeight = data.block.header.height;
    return latestKnownHeight;
  } catch {
    return latestKnownHeight;
  }
}

async function fetchBlockWithRetry(height: number): Promise<unknown | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Don't retry on null — missing blocks are just skipped
      return await fetchBlock(height);
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

  // Default: start from latest block (skip historical data)
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
      // Refresh chain tip periodically
      if (blocksProcessed % 500 === 0) {
        latestKnownHeight = await fetchLatestBlockHeight();
      }

      const isAtTip = currentHeight > latestKnownHeight;

      if (isAtTip) {
        // At chain tip — wait and refresh
        await sleep(IDLE_INTERVAL_MS);
        latestKnownHeight = await fetchLatestBlockHeight();
        continue;
      }

      const blockData = await fetchBlockWithRetry(currentHeight);

      if (blockData === null) {
        // Block genuinely missing (skipped in neardata) — move to next
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

      // Log progress periodically
      if (blocksProcessed % 1000 === 0) {
        const behindBlocks = latestKnownHeight - currentHeight;
        console.log(`Progress: block ${currentHeight}, ${totalEvents} events, ${blocksProcessed} processed, ${skippedBlocks} skipped, ${behindBlocks} behind`);
      }

      currentHeight++;
      await sleep(POLL_INTERVAL_MS);
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
