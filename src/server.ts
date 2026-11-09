// The MCP server: tool definitions only. Separate from index.ts (the CLI) so
// tests can build it against a fake API without touching stdio or disk.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NocturneSource } from './api.ts';
import { formatConnection, formatEntries, formatEntryText, formatMoods, formatSongs, type ToolText } from './format.ts';

export const VERSION = '0.2.1';

// AI-facing guidance.
export const INSTRUCTIONS = [
  'Nocturne is a journaling app. It is not therapy, not a medical or mental health service, and not a substitute for a professional.',
  'Mood labels and valence/arousal numbers come from an automatic read of the person\'s writing. They can be wrong.',
  'Never present mood data as a diagnosis, assessment, symptom, or clinical finding, and never name or suggest a condition.',
  'Describe patterns in plain words, for example "most entries this week were labeled calm", and let the person interpret them.',
  'Default access is moods, entry dates and songs. Full entry text is only available if the person turned it on themselves.',
  'If get_entry_text says it is off, tell the person once and move on. Do not ask again or try to work around it.',
  'If someone seems to be in danger or crisis, encourage them to contact local emergency services or a crisis line.',
  'All tools are read-only. Dates are YYYY-MM-DD in the person\'s local time zone.',
].join(' ');

// Prepended in demo mode so the AI app never presents the fictional journal as the person's own.
export const DEMO_INSTRUCTIONS =
  'DEMO MODE: every tool returns fictional data about a made-up person, Maya Chen, not the person you are talking to. ' +
  'Say so when you share results. The permissions and access log work exactly as they do for a real account.';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const range = {
  from: ymd.optional().describe('Start date, inclusive. Default: 29 days before `to`.'),
  to: ymd.optional().describe('End date, inclusive. Default: today. Ranges are limited to 366 days.'),
};

function ok(t: ToolText) {
  return { content: [{ type: 'text' as const, text: t.text }] };
}
function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
}
async function run(fn: () => Promise<ToolText>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

// getApi runs per call, so logging in or out takes effect without restarting the app.
export function buildServer(getApi: () => NocturneSource, tz: string, opts: { demo?: boolean } = {}): McpServer {
  const instructions = opts.demo ? `${DEMO_INSTRUCTIONS} ${INSTRUCTIONS}` : INSTRUCTIONS;
  const server = new McpServer({ name: 'Nocturne', version: VERSION }, { instructions });
  const ro = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'get_mood_timeline',
    {
      title: 'Mood timeline',
      description:
        'Mood over a date range, grouped by day or week: number of entries, average valence and arousal, top emotion labels, ' +
        'and whether valence is rising, falling or steady. No journal text.',
      inputSchema: { ...range, bucket: z.enum(['day', 'week']).default('day') },
      annotations: ro,
    },
    ({ from, to, bucket }) => run(async () => formatMoods(await getApi().moods({ from, to, bucket, tz }))),
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List entries',
      description:
        'Journal entries in a date range, newest first: id, date, time, mood label, valence, arousal, and whether songs or a ' +
        'drawing are attached. Never returns entry text. Filter by a primary emotion label (for example "joy") if useful.',
      inputSchema: {
        ...range,
        emotion: z.string().max(40).optional().describe('Only entries whose primary emotion is this label.'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: ro,
    },
    ({ from, to, emotion, limit, offset }) =>
      run(async () => formatEntries(await getApi().entries({ from, to, emotion, limit, offset, tz }))),
  );

  server.registerTool(
    'list_songs',
    {
      title: 'List songs',
      description:
        'Songs attached to entries in a date range: the song the person picked and the songs Nocturne suggested. ' +
        'Track name and artist only.',
      inputSchema: { ...range, limit: z.number().int().min(1).max(200).optional().describe('Entries, default 50.') },
      annotations: ro,
    },
    ({ from, to, limit }) => run(async () => formatSongs(await getApi().songs({ from, to, limit, tz }))),
  );

  server.registerTool(
    'get_entry_text',
    {
      title: 'Read entry text',
      description:
        'Full text of one journal entry, by id from list_entries. OFF by default: works only if the person turned on full-text ' +
        'access for this connection. Every read is logged and shown to them. Only use it when the person asks about a specific entry.',
      inputSchema: { id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'use an id from list_entries') },
      annotations: ro,
    },
    ({ id }) => run(async () => formatEntryText(await getApi().entryText(id, tz))),
  );

  server.registerTool(
    'get_connection_info',
    {
      title: 'Connection info',
      description:
        'Which permissions this Nocturne connection has, including whether full entry text is on. ' +
        'In demo mode it also returns the access log of this session.',
      inputSchema: {},
      annotations: ro,
    },
    () => run(async () => formatConnection(await getApi().whoami())),
  );

  return server;
}
