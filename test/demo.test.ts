// Demo mode: fictional journal served in memory through the same scope checks
// and shaping as real mode. fetch is replaced with a thrower for the whole
// file, so any network call fails the test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DemoSource } from '../src/demo/source.ts';
import { seedDemo, demoId, COORDS } from '../src/demo/seed.ts';
import { DEMO_INSTRUCTIONS, buildServer } from '../src/server.ts';

const TZ = 'America/New_York';
// Sunday 2026-11-08, 12:00 in New York.
const NOW = new Date('2026-11-08T17:00:00Z');

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error('demo mode must not use the network');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const byDay = (now: Date) => new Map(seedDemo(now, TZ).map((e) => [e.day, e]));

test('seed is relative to the injected now, in the local time zone', () => {
  const j = seedDemo(NOW, TZ);
  assert.ok(j.length >= 26 && j.length <= 36, `about 30 entries, got ${j.length}`);
  for (const e of j) {
    assert.ok(Date.parse(e.created_at) <= NOW.getTime(), 'nothing in the future');
    assert.ok(e.day >= -42 && e.day <= 0);
    assert.ok(e.primary_emotion && e.primary_emotion in COORDS, `known label ${e.primary_emotion}`);
    assert.ok(e.valence !== null && Math.abs(Number(e.valence)) <= 1);
    const sentences = e.text.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length;
    assert.ok(sentences >= 2 && sentences <= 5, `2 to 5 sentences: ${e.text}`);
    assert.ok(!/[—;]/.test(e.text), 'no em dashes or semicolons');
  }
  assert.ok(j.filter((e) => e.has_songs).length / j.length > 0.75, 'most entries have a song');

  const d = byDay(NOW);
  const anchor = (day: number) => {
    const e = d.get(day);
    assert.ok(e, `entry on day ${day}`);
    return { date: local(e.created_at), emotion: e.primary_emotion };
  };
  assert.deepEqual(anchor(-24), { date: '2026-10-15', emotion: 'anxiety' });
  assert.deepEqual(anchor(-22), { date: '2026-10-17', emotion: 'anxiety' });
  assert.deepEqual(anchor(-21), { date: '2026-10-18', emotion: 'relaxation' });
  assert.deepEqual(anchor(-10), { date: '2026-10-29', emotion: 'sadness' });
  assert.deepEqual(anchor(-9), { date: '2026-10-30', emotion: 'anger' });
  assert.deepEqual(anchor(-8), { date: '2026-10-31', emotion: 'apathy' });
  assert.deepEqual(anchor(-3), { date: '2026-11-05', emotion: 'apathy' });
  assert.deepEqual(anchor(-2), { date: '2026-11-06', emotion: 'pride' });
  assert.deepEqual(anchor(-1), { date: '2026-11-07', emotion: 'anxiety' });
  assert.deepEqual(anchor(0), { date: '2026-11-08', emotion: 'anxiety' });
  assert.ok(Number(d.get(-22)!.valence) < 0 && Number(d.get(-21)!.valence) > 0, 'relief after the midterm');

  // Filler follows the weekday: Sunday 2026-11-01 is a long run, Tuesday 2026-10-27 a climbing night.
  assert.match(d.get(-7)!.text, /talked it out/);
  assert.match(byDay(NOW).get(-12)!.text, /climb|Priya|route|gym|V\d/i);
  assert.match(byDay(NOW).get(-14)!.text, /run|mile/i);

  // A week later every anchor moves with it.
  const later = new Date(NOW.getTime() + 7 * 86_400_000);
  assert.equal(local(byDay(later).get(-21)!.created_at), '2026-10-25');

  // Early in the morning, today's 08:40 entry hasn't happened yet.
  assert.equal(byDay(new Date('2026-11-08T10:00:00Z')).has(0), false);
});

async function connect(raw = false) {
  const source = new DemoSource({ now: NOW, tz: TZ, raw });
  const server = buildServer(() => source, TZ, { demo: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: res.isError === true, text: (res.content as Array<{ text: string }>)[0].text };
  };
  return { client, source, call };
}

const RANGE = { from: '2026-09-27', to: '2026-11-08' };

test('default tools never return entry text in demo mode', async () => {
  const { client, source, call } = await connect(true); // even with raw on, only get_entry_text returns text
  assert.match(client.getInstructions() ?? '', /^DEMO MODE/);
  assert.ok(!/[—;]/.test(DEMO_INSTRUCTIONS));
  const outputs = [
    await call('get_mood_timeline', RANGE),
    await call('get_mood_timeline', { ...RANGE, bucket: 'week' }),
    await call('list_entries', { ...RANGE, limit: 200 }),
    await call('list_songs', { ...RANGE, limit: 200 }),
    await call('get_connection_info'),
  ];
  for (const o of outputs) assert.equal(o.isError, false, o.text);
  const all = outputs.map((o) => o.text).join('\n');
  for (const e of source.journal) {
    for (const sentence of e.text.split('. ')) {
      assert.ok(!all.includes(sentence.slice(0, 40)), `leaked: ${sentence}`);
    }
  }
  const listed = JSON.parse(outputs[2].text.slice(outputs[2].text.indexOf('{')));
  assert.equal(listed.entries.length, source.journal.length);
  assert.deepEqual(Object.keys(listed.entries[0]).sort(), ['date', 'hasDrawing', 'hasSongs', 'id', 'mood', 'time']);
  assert.match(outputs[3].text, /Under Pressure/);
  const anxious = JSON.parse((await call('list_entries', { ...RANGE, emotion: 'anxiety' })).text.split('\n\n')[1]);
  assert.ok(anxious.entries.length >= 4 && anxious.entries.every((e: { mood: { primaryEmotion: string } }) => e.mood.primaryEmotion === 'anxiety'));
  await client.close();
});

test('get_entry_text is denied without --demo-raw', async () => {
  const { client, call } = await connect(false);
  const info = await call('get_connection_info');
  assert.match(info.text, /DEMO MODE/);
  assert.match(info.text, /Full entry text is OFF/);
  const res = await call('get_entry_text', { id: demoId(-21) });
  assert.equal(res.isError, true);
  assert.match(res.text, /off for this connection/);
  assert.match(res.text, /--demo-raw/);
  assert.ok(!res.text.includes('Midterm done'));
  await client.close();
});

test('get_entry_text works with --demo-raw', async () => {
  const { client, call } = await connect(true);
  assert.match((await call('get_connection_info')).text, /Full entry text is ON/);
  const res = await call('get_entry_text', { id: demoId(-21) });
  assert.equal(res.isError, false, res.text);
  assert.match(res.text, /Midterm done/);
  assert.match(res.text, /2026-10-18 18:20/);
  const missing = await call('get_entry_text', { id: '4d415941-0000-4000-8000-000000000000' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /Not found/);
  await client.close();
});

test('access log records allows and denies, and get_connection_info shows it', async () => {
  const { client, source, call } = await connect(false);
  await call('get_mood_timeline', RANGE);
  await call('get_entry_text', { id: demoId(-9) });
  const log = source.audit.entries;
  assert.deepEqual(
    log.map((e) => [e.target, e.scopeUsed, e.severity, e.decision, e.reason ?? null]),
    [
      ['nocturne://moods/timeline', 'moods:read', 'normal', 'allow', null],
      [`nocturne://entries/${demoId(-9)}/text`, 'journals:read:raw', 'elevated', 'deny', 'missing_scope'],
    ],
  );
  const info = await call('get_connection_info');
  const data = JSON.parse(info.text.slice(info.text.indexOf('{')));
  assert.equal(data.demo, true);
  assert.deepEqual(
    data.accessLog.map((e: { target: string; decision: string }) => [e.target, e.decision]),
    [
      ['whoami', 'allow'],
      [`nocturne://entries/${demoId(-9)}/text`, 'deny'],
      ['nocturne://moods/timeline', 'allow'],
    ],
  );
  await client.close();
});

