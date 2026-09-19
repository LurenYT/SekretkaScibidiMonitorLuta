import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'site', 'data', 'leaderboard.json');

const API_KEY = process.env.ROBLOX_API_KEY;
const UNIVERSE_ID = process.env.UNIVERSE_ID || '10764295351';
const DATASTORE_NAME = process.env.DATASTORE_NAME || 'Sekretochka';
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

function assertConfig() {
  if (!API_KEY) {
    throw new Error('ROBLOX_API_KEY is missing. Add it as a GitHub Actions repository secret.');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function robloxFetch(url, options = {}, attempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      accept: 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 750 * (2 ** attempt);
      console.warn(`[leaderboard] Roblox API ${response.status}; retrying in ${delay} ms...`);
      await sleep(delay);
      return robloxFetch(url, options, attempt + 1);
    }
    throw new Error(`Roblox API ${response.status} ${response.statusText}: ${body.slice(0, 1000)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function getEntriesArray(page) {
  if (Array.isArray(page?.dataStoreEntries)) return page.dataStoreEntries;
  if (Array.isArray(page?.entries)) return page.entries;
  if (Array.isArray(page?.data)) return page.data;
  return [];
}

async function listAllPlayerEntries() {
  const result = [];
  let pageToken = '';
  let totalListed = 0;

  do {
    const url = new URL(`${DATASTORE_BASE}/entries`);
    url.searchParams.set('maxPageSize', '256');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const page = await robloxFetch(url);
    const entries = getEntriesArray(page);
    totalListed += entries.length;

    for (const entry of entries) {
      const rawId = typeof entry?.id === 'string' ? entry.id : '';
      const key = rawId.split('/').pop() || '';
      if (/^Data_\d+$/.test(key)) {
        result.push({
          key,
          id: rawId,
          path: typeof entry?.path === 'string' ? entry.path : ''
        });
      }
    }

    pageToken = page?.nextPageToken || '';
  } while (pageToken);

  console.log(`[leaderboard] Listed ${totalListed} total entries; ${result.length} matched Data_<UserId>.`);
  if (result.length === 0 && totalListed > 0) {
    console.warn('[leaderboard] Entries exist, but none matched Data_<UserId>.');
  }

  const unique = new Map();
  for (const entry of result) unique.set(entry.key, entry);
  return [...unique.values()];
}

function entryPathToUrl(resourcePath) {
  if (!resourcePath) return null;
  if (/^https?:\/\//i.test(resourcePath)) return resourcePath;
  const clean = resourcePath.replace(/^\/+/, '');
  if (clean.startsWith('cloud/v2/')) return `https://apis.roblox.com/${clean}`;
  return `${API_ROOT}/${clean}`;
}

async function getPlayerEntry(entry) {
  const pathUrl = entryPathToUrl(entry?.path);
  if (pathUrl) return robloxFetch(pathUrl);

  // GetDataStore("Sekretochka") without a scope uses the global scope.
  const scopedUrl = `${DATASTORE_BASE}/scopes/global/entries/${encodeURIComponent(entry.key)}`;
  return robloxFetch(scopedUrl);
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

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
  return output;
}

function userIdFromEntryKey(entryKey) {
  const match = /^Data_(\d+)$/.exec(entryKey);
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw)) {
    const name = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
    result[name] = milestoneNumber(value);
  }
  return result;
}

function unwrapEntryValue(envelope) {
  let value = envelope?.value ?? envelope;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // Keep the string; downstream optional chaining will simply produce no milestones.
    }
  }
  return value;
}

async function getUsersByIds(userIds) {
  const users = new Map();
  const ids = [...new Set(userIds.filter(Boolean).map(id => Number(id)).filter(Number.isSafeInteger))];

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let response;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch('https://users.roblox.com/v1/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ userIds: batch, excludeBannedUsers: false })
      });
      if (response.ok || (response.status !== 429 && response.status < 500)) break;
      await sleep(600 * (2 ** attempt));
    }

    if (!response?.ok) {
      console.warn(`Username lookup failed (${response?.status ?? 'network'}); using User IDs for this batch.`);
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
  console.log(`[leaderboard] Universe ${UNIVERSE_ID}, DataStore ${DATASTORE_NAME}`);
  console.log('[leaderboard] Listing player entries...');

  const entries = await listAllPlayerEntries();
  console.log(`[leaderboard] Reading ${entries.length} player entries with concurrency ${READ_CONCURRENCY}...`);

  const results = await mapWithConcurrency(entries, READ_CONCURRENCY, async entry => {
    const envelope = await getPlayerEntry(entry);
    const userId = userIdFromEntryKey(entry.key);
    if (!userId) return null;

    const data = unwrapEntryValue(envelope);
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
      const label = result.__item?.key || result.__item?.id || String(result.__item);
      console.warn(`[leaderboard] Failed entry ${label}: ${result.__error.message}`);
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

  return {
    generatedAt: new Date().toISOString(),
    universeId: UNIVERSE_ID,
    dataStore: DATASTORE_NAME,
    scannedPlayers: validPlayers.length,
    failedEntries,
    survivors: finalizeCategory(survivors, CHARACTER_ORDER.survivors, users),
    killers: finalizeCategory(killers, CHARACTER_ORDER.killers, users)
  };
}

async function main() {
  try {
    const leaderboard = await buildLeaderboard();
    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await writeFile(OUTPUT_FILE, `${JSON.stringify(leaderboard, null, 2)}\n`, 'utf8');
    console.log(`[leaderboard] Wrote ${OUTPUT_FILE}`);
    console.log(`[leaderboard] Scanned ${leaderboard.scannedPlayers} players; ${leaderboard.failedEntries} read failures.`);
  } catch (error) {
    console.error(`[leaderboard] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

await main();
