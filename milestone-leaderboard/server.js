import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ROBLOX_API_KEY;
const UNIVERSE_ID = process.env.UNIVERSE_ID || '10764295351';
const DATASTORE_NAME = process.env.DATASTORE_NAME || 'Sekretochka';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 300000);
const READ_CONCURRENCY = Math.max(1, Number(process.env.ROBLOX_READ_CONCURRENCY || 8));

const API_ROOT = 'https://apis.roblox.com/cloud/v2';
const DATASTORE_BASE = `${API_ROOT}/universes/${encodeURIComponent(UNIVERSE_ID)}/data-stores/${encodeURIComponent(DATASTORE_NAME)}`;

const CHARACTER_ORDER = {
  survivors: [
    '007n7', 'Belca', 'Builderman', 'Chance', 'Dusekkar', 'Elliot', 'Gold1',
    'Guest1337', 'Ipix', 'Laren', 'Lepkas', 'Mosik', 'Noob', 'Shedletsky',
    'TaiR', 'Taph', 'Tea', 'TwoTime', 'Weduza'
  ],
  killers: ['1x1x1x1', 'JohnDoe', 'Noli', 'Slasher', 'c00lkidd']
};

let cache = {
  data: null,
  updatedAt: 0,
  refreshPromise: null,
  lastError: null
};

function assertConfig() {
  if (!API_KEY || API_KEY === 'PASTE_YOUR_API_KEY_HERE') {
    throw new Error('ROBLOX_API_KEY is missing. Copy .env.example to .env and paste your Roblox Open Cloud API key.');
  }
}

async function robloxFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      'accept': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Roblox API ${response.status} ${response.statusText}: ${body.slice(0, 800)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function listAllPlayerEntryIds() {
  const result = [];
  let pageToken = '';

  do {
    const url = new URL(`${DATASTORE_BASE}/entries`);
    url.searchParams.set('maxPageSize', '256');
    url.searchParams.set('filter', 'id.startsWith("Data_")');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const page = await robloxFetch(url);
    for (const entry of page?.dataStoreEntries || []) {
      if (typeof entry?.id === 'string' && entry.id.startsWith('Data_')) {
        result.push(entry.id);
      }
    }
    pageToken = page?.nextPageToken || '';
  } while (pageToken);

  return [...new Set(result)];
}

async function getPlayerEntry(entryId) {
  const url = `${DATASTORE_BASE}/entries/${encodeURIComponent(entryId)}`;
  return robloxFetch(url);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        output[index] = await mapper(items[index], index);
      } catch (error) {
        output[index] = { __error: error, __item: items[index] };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

function userIdFromEntryId(entryId) {
  const match = /^Data_(\d+)$/.exec(entryId);
  return match ? match[1] : null;
}

function milestoneNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /^(-?\d+(?:\.\d+)?)NumVal$/.exec(value);
    if (match) return Number(match[1]);
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return 0;
}

function normalizeMilestones(raw, suffix = 'Milestone') {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [key, value] of Object.entries(raw)) {
    const name = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
    result[name] = milestoneNumber(value);
  }
  return result;
}

async function getUsersByIds(userIds) {
  const users = new Map();
  const ids = [...new Set(userIds.filter(Boolean).map(id => Number(id)).filter(Number.isSafeInteger))];

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const response = await fetch('https://users.roblox.com/v1/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ userIds: batch, excludeBannedUsers: false })
    });

    if (!response.ok) {
      console.warn(`Username lookup failed (${response.status}); falling back to User IDs for this batch.`);
      continue;
    }

    const body = await response.json();
    for (const user of body?.data || []) {
      users.set(String(user.id), {
        userId: String(user.id),
        username: user.name || `User ${user.id}`,
        displayName: user.displayName || user.name || `User ${user.id}`
      });
    }
  }

  return users;
}

function newRecord(name) {
  return { character: name, level: 0, players: [] };
}

function updateTop(map, character, level, userId) {
  const current = map.get(character) || newRecord(character);

  if (level > current.level) {
    current.level = level;
    current.players = level > 0 ? [userId] : [];
  } else if (level === current.level && level > 0 && !current.players.includes(userId)) {
    current.players.push(userId);
  }

  map.set(character, current);
}

function finalizeCategory(map, preferredOrder, users) {
  for (const name of preferredOrder) {
    if (!map.has(name)) map.set(name, newRecord(name));
  }

  const order = new Map(preferredOrder.map((name, index) => [name, index]));
  return [...map.values()]
    .map(row => ({
      character: row.character,
      level: row.level,
      players: row.players.map(userId => users.get(userId) || {
        userId,
        username: `User ${userId}`,
        displayName: `User ${userId}`
      })
    }))
    .sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      const ai = order.has(a.character) ? order.get(a.character) : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b.character) ? order.get(b.character) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.character.localeCompare(b.character);
    });
}

async function buildLeaderboard() {
  assertConfig();
  console.log('[leaderboard] Listing player entries...');
  const entryIds = await listAllPlayerEntryIds();
  console.log(`[leaderboard] Found ${entryIds.length} player entries.`);

  const results = await mapWithConcurrency(entryIds, READ_CONCURRENCY, async entryId => {
    const envelope = await getPlayerEntry(entryId);
    const userId = userIdFromEntryId(entryId);
    if (!userId) return null;

    // Open Cloud v2 wraps the actual DataStore value in `value`.
    const data = envelope?.value ?? envelope;
    return {
      userId,
      survivors: normalizeMilestones(data?.Achievements?.SurvivorsMilestones),
      killers: normalizeMilestones(data?.Achievements?.KillersMilestones)
    };
  });

  const survivors = new Map();
  const killers = new Map();
  const validPlayers = [];
  let failedEntries = 0;

  for (const result of results) {
    if (!result) continue;
    if (result.__error) {
      failedEntries += 1;
      console.warn(`[leaderboard] Failed entry ${result.__item}: ${result.__error.message}`);
      continue;
    }

    validPlayers.push(result.userId);
    for (const [character, level] of Object.entries(result.survivors)) {
      updateTop(survivors, character, level, result.userId);
    }
    for (const [character, level] of Object.entries(result.killers)) {
      updateTop(killers, character, level, result.userId);
    }
  }

  const users = await getUsersByIds(validPlayers);
  const now = new Date();

  return {
    generatedAt: now.toISOString(),
    universeId: UNIVERSE_ID,
    dataStore: DATASTORE_NAME,
    scannedPlayers: validPlayers.length,
    failedEntries,
    survivors: finalizeCategory(survivors, CHARACTER_ORDER.survivors, users),
    killers: finalizeCategory(killers, CHARACTER_ORDER.killers, users)
  };
}

async function refreshCache({ force = false } = {}) {
  const fresh = cache.data && Date.now() - cache.updatedAt < CACHE_TTL_MS;
  if (!force && fresh) return cache.data;
  if (cache.refreshPromise) return cache.refreshPromise;

  cache.refreshPromise = (async () => {
    try {
      const data = await buildLeaderboard();
      cache.data = data;
      cache.updatedAt = Date.now();
      cache.lastError = null;
      return data;
    } catch (error) {
      cache.lastError = error;
      console.error('[leaderboard] Refresh failed:', error);
      if (cache.data) return cache.data;
      throw error;
    } finally {
      cache.refreshPromise = null;
    }
  })();

  return cache.refreshPromise;
}

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const data = await refreshCache();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      ...data,
      cacheAgeMs: Date.now() - cache.updatedAt,
      stale: Boolean(cache.lastError)
    });
  } catch (error) {
    res.status(503).json({
      error: 'Could not load the leaderboard.',
      details: error.message
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(API_KEY),
    hasCache: Boolean(cache.data),
    lastError: cache.lastError?.message || null
  });
});

app.listen(PORT, () => {
  console.log(`Milestone leaderboard: http://localhost:${PORT}`);
  refreshCache().catch(() => {});
});

// Refresh quietly in the background while the server is running.
setInterval(() => {
  refreshCache({ force: true }).catch(() => {});
}, CACHE_TTL_MS).unref();
