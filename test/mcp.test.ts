// No network: every test injects a fake fetch.
// These cover the local half: the second output allowlist, error messages,
// the MCP surface, and the session file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NocturneApi, NocturneError, type Fetch } from '../src/api.ts';
import { formatEntries, formatMoods, formatSongs } from '../src/format.ts';
import { INSTRUCTIONS, buildServer } from '../src/server.ts';

const SECRET = 'I told nobody about the thing at work';
const ID = '8f4b2c1e-5d6a-4b7c-9e8f-0a1b2c3d4e5f';

// What a buggy or older backend might send: right shape plus fields that must not pass.
const leakyEntries = {
  from: '2026-11-01',
  to: '2026-11-07',
  timezone: 'America/New_York',
  nextOffset: null,
  entries: [
    {
      id: ID,
      date: '2026-11-02',
      time: '10:30',
      mood: { primaryEmotion: 'joy', valence: 0.6, arousal: 0.1, tags: ['private_tag'] },
      hasSongs: true,
      hasDrawing: false,
      text: SECRET,
      preview: SECRET,
      internal_flag: 'high',
    },
  ],
  full_text: SECRET,
};
const leakyMoods = {
  from: '2026-11-01',
  to: '2026-11-07',
  timezone: 'UTC',
  bucket: 'day',
  points: [{ date: '2026-11-02', entries: 1, avgValence: 0.6, avgArousal: 0.1, topEmotions: ['joy', SECRET], note: SECRET }],
  trend: { valence: SECRET, changePerWeek: 0 },
  entriesWithMood: 1,
  entriesWithoutMood: 0,
  excerpt: SECRET,
};
const leakySongs = {
  from: '2026-11-01',
  to: '2026-11-07',
  timezone: 'UTC',
  entries: [
    {
      entryId: ID,
      date: '2026-11-02',
      picked: { title: 'Pink + White', artist: 'Frank Ocean', why: SECRET },
      playlist: [{ title: 'Holocene', artist: 'Bon Iver', reason: SECRET }],
      text: SECRET,
    },
  ],
};

type Call = { url: URL; init: RequestInit };
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>, calls: Call[] = []): Fetch {
  return (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k));
    const r = key ? routes[key] : { status: 404, body: { success: false, error: 'not found' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as Fetch;
}
const okBody = (data: unknown) => ({ body: { success: true, data } });

test('default-scope formatters drop anything outside the allowlist', () => {
  for (const out of [formatEntries(leakyEntries), formatMoods(leakyMoods), formatSongs(leakySongs)]) {
    assert.ok(!out.text.includes(SECRET), out.text);
    for (const word of ['private_tag', 'internal_flag', 'preview', 'reason', 'full_text']) {
      assert.ok(!out.text.includes(word), `${word} leaked`);
    }
  }
  const e = formatEntries(leakyEntries).data as { entries: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(e.entries[0]).sort(), ['date', 'hasDrawing', 'hasSongs', 'id', 'mood', 'time']);
  assert.deepEqual(e.entries[0].mood, { primaryEmotion: 'joy', valence: 0.6, arousal: 0.1 });
  const m = formatMoods(leakyMoods).data as { trend: { valence: string } };
  assert.equal(m.trend.valence, 'not_enough_data');
});

test('no token: fails with a login hint and makes no request', async () => {
  const calls: Call[] = [];
  const api = new NocturneApi('https://api.test/api', null, fakeFetch({}, calls));
  await assert.rejects(api.moods({ tz: 'UTC' }), (e: NocturneError) => e.code === 'missing_token' && /nocturne-mcp login/.test(e.message));
  assert.equal(calls.length, 0);
});

test('requests carry the bearer token, time zone and range', async () => {
  const calls: Call[] = [];
  const api = new NocturneApi('https://api.test/api', 'noct_mcp_x', fakeFetch({ '/mcp/v1/moods': okBody(leakyMoods) }, calls));
  await api.moods({ from: '2026-11-01', to: '2026-11-07', tz: 'Asia/Hong_Kong', bucket: 'week' });
  assert.equal(calls[0].url.pathname, '/api/mcp/v1/moods');
  assert.equal(calls[0].url.searchParams.get('tz'), 'Asia/Hong_Kong');
  assert.equal(calls[0].url.searchParams.get('bucket'), 'week');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer noct_mcp_x');
});

test('raw text denial explains how the person turns it on, and says not to keep asking', async () => {
  const api = new NocturneApi(
    'https://api.test/api',
    'noct_mcp_x',
    fakeFetch({ '/text': { status: 403, body: { success: false, error: 'missing_scope' } } }),
  );
  await assert.rejects(api.entryText(ID, 'UTC'), (e: NocturneError) => {
    assert.equal(e.status, 403);
    assert.match(e.message, /off for this connection/);
    assert.match(e.message, /more than once/);
    return true;
  });
});

test('revoked connections get a reconnect message', async () => {
  const api = new NocturneApi('https://api.test/api', 'noct_mcp_x', fakeFetch({ '/v1/entries': { status: 403, body: { success: false, error: 'revoked_grant' } } }));
  await assert.rejects(api.entries({ tz: 'UTC' }), /turned off in Nocturne/);
});

async function connect(fetchImpl: Fetch) {
  const server = buildServer(() => new NocturneApi('https://api.test/api', 'noct_mcp_x', fetchImpl), 'UTC');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test('MCP surface: read-only tools only, and instructions draw the not-therapy line', async () => {
  const client = await connect(fakeFetch({}));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'get_connection_info',
    'get_entry_text',
    'get_mood_timeline',
    'list_entries',
    'list_songs',
  ]);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be read-only`);
  const instructions = client.getInstructions() ?? '';
  assert.equal(instructions, INSTRUCTIONS);
  assert.match(instructions, /journaling app/);
  assert.match(instructions, /not therapy/);
  assert.match(instructions, /diagnosis/);
  assert.ok(!/[—;]/.test(instructions), 'no em dashes or semicolons in AI-facing copy');
  await client.close();
});

test('MCP list_entries returns no text even if the backend leaks it', async () => {
  const client = await connect(fakeFetch({ '/v1/entries': okBody(leakyEntries) }));
  const res = await client.callTool({ name: 'list_entries', arguments: { from: '2026-11-01', to: '2026-11-07' } });
  const text = (res.content as Array<{ text: string }>)[0].text;
  assert.ok(!text.includes(SECRET));
  assert.match(text, /joy/);
  assert.match(text, new RegExp(ID));
  await client.close();
});

test('MCP get_entry_text surfaces the denial as a tool error', async () => {
  const client = await connect(fakeFetch({ '/text': { status: 403, body: { success: false, error: 'missing_scope' } } }));
  const res = await client.callTool({ name: 'get_entry_text', arguments: { id: ID } });
  assert.equal(res.isError, true);
  assert.match((res.content as Array<{ text: string }>)[0].text, /off for this connection/);
  await client.close();
});

test('session file is written mode 600 inside a 700 directory', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nocturne-mcp-test-'));
  process.env.NOCTURNE_MCP_HOME = join(home, 'cfg');
  try {
    const cfg = await import(`../src/config.ts?home=${Date.now()}`);
    cfg.writeSession({ token: 'noct_mcp_x', via: 'app', savedAt: 'now' });
    assert.equal(statSync(cfg.SESSION_FILE).mode & 0o777, 0o600);
    assert.equal(statSync(cfg.CONFIG_DIR).mode & 0o777, 0o700);
    assert.equal(cfg.readSession().token, 'noct_mcp_x');
    cfg.clearSession();
    assert.equal(cfg.readSession(), null);
  } finally {
    delete process.env.NOCTURNE_MCP_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('real-account commands run without any opt-in env var', async () => {
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(join(tmpdir(), 'nocturne-mcp-real-'));
  try {
    const env = { ...process.env, NOCTURNE_MCP_HOME: home };
    delete env.NOCTURNE_MCP_REAL;
    delete env.NOCTURNE_DEMO;
    const out = execFileSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(import.meta.dirname, '../src/index.ts'), 'whoami'],
      { env, encoding: 'utf8' },
    );
    assert.equal(out.trim(), 'Not connected.');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
