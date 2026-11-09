// Turns backend responses into tool output. The backend already shapes
// default-scope data from an allowlist. This is the second allowlist, on the
// user's machine: every field is copied by name, so if the backend ever
// returned more than it should (an older deploy, a bug), it still wouldn't
// reach the AI app. Only formatEntryText passes journal text through.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Same rule as the backend: one or two words, nothing that could hold a sentence.
const emotion = (v: unknown): string | null =>
  typeof v === 'string' && v.length < 30 && /^[A-Za-z][A-Za-z_-]*( [A-Za-z][A-Za-z_-]*)?$/.test(v) ? v : null;
const ymd = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const hm = (v: unknown): string | null => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
const uuidish = (v: unknown): string | null =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;

export interface ToolText {
  text: string;
  data: unknown;
}

const block = (summary: string, data: unknown): ToolText => ({
  text: `${summary}\n\n${JSON.stringify(data, null, 2)}`,
  data,
});

export function formatMoods(raw: unknown): ToolText {
  const d = obj(raw);
  const trend = obj(d.trend);
  const data = {
    from: ymd(d.from),
    to: ymd(d.to),
    timezone: str(d.timezone, 64),
    bucket: d.bucket === 'week' ? 'week' : 'day',
    points: arr(d.points).map((p) => {
      const o = obj(p);
      return {
        date: ymd(o.date),
        entries: num(o.entries),
        avgValence: num(o.avgValence),
        avgArousal: num(o.avgArousal),
        topEmotions: arr(o.topEmotions).map(emotion).filter(Boolean).slice(0, 3),
      };
    }),
    trend: {
      valence: ['rising', 'falling', 'steady', 'not_enough_data'].includes(trend.valence as string) ? trend.valence : 'not_enough_data',
      changePerWeek: num(trend.changePerWeek),
    },
    entriesWithMood: num(d.entriesWithMood),
    entriesWithoutMood: num(d.entriesWithoutMood),
    truncated: d.truncated === true,
  };
  const summary =
    `Mood timeline ${data.from} to ${data.to} (${data.timezone}), ${data.points.length} ${data.bucket}(s) with mood data. ` +
    `Valence trend: ${String(data.trend.valence).replaceAll('_', ' ')}. ` +
    'Valence runs from -1 (unpleasant) to 1 (pleasant), arousal from -1 (calm) to 1 (energized). ' +
    'These are automatic reads of the writing, not assessments.';
  return block(summary, data);
}

export function formatEntries(raw: unknown): ToolText {
  const d = obj(raw);
  const entries = arr(d.entries).map((e) => {
    const o = obj(e);
    const m = obj(o.mood);
    const primary = emotion(m.primaryEmotion);
    return {
      id: uuidish(o.id),
      date: ymd(o.date),
      time: hm(o.time),
      mood: primary ? { primaryEmotion: primary, valence: num(m.valence), arousal: num(m.arousal) } : null,
      hasSongs: o.hasSongs === true,
      hasDrawing: o.hasDrawing === true,
    };
  });
  const data = {
    from: ymd(d.from),
    to: ymd(d.to),
    timezone: str(d.timezone, 64),
    entries,
    nextOffset: num(d.nextOffset),
  };
  const more = data.nextOffset !== null ? ` More available, pass offset=${data.nextOffset}.` : '';
  return block(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${data.from} to ${data.to}. Dates and moods only, no text.${more}`, data);
}

export function formatSongs(raw: unknown): ToolText {
  const d = obj(raw);
  const track = (t: unknown) => {
    const o = obj(t);
    const title = str(o.title, 200);
    const artist = str(o.artist, 200);
    return title && artist ? { title, artist } : null;
  };
  const entries = arr(d.entries).map((e) => {
    const o = obj(e);
    return {
      entryId: uuidish(o.entryId),
      date: ymd(o.date),
      picked: track(o.picked),
      playlist: arr(o.playlist).map(track).filter(Boolean),
    };
  });
  const data = { from: ymd(d.from), to: ymd(d.to), timezone: str(d.timezone, 64), entries };
  return block(
    `Songs on ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${data.from} to ${data.to}. "picked" is the song the person chose, "playlist" is what Nocturne suggested.`,
    data,
  );
}

/** The only formatter that returns journal text. */
export function formatEntryText(raw: unknown): ToolText {
  const o = obj(raw);
  const data = {
    id: uuidish(o.id),
    date: ymd(o.date),
    time: hm(o.time),
    text: typeof o.text === 'string' ? o.text : '',
    bullets: arr(o.bullets).filter((b): b is string => typeof b === 'string'),
  };
  return block(`Journal entry from ${data.date} ${data.time ?? ''}. This is the person's private writing.`.trim(), data);
}

export function formatConnection(raw: unknown): ToolText {
  const o = obj(raw);
  const scopes = arr(o.scopes).map((s) => str(s, 40)).filter(Boolean) as string[];
  const base = { clientName: str(o.clientName), scopes, rawTextEnabled: o.rawTextEnabled === true, grantedAt: str(o.grantedAt, 40) };
  const access = `Full entry text is ${base.rawTextEnabled ? 'ON' : 'OFF'} for this connection.`;
  if (o.demo !== true) return block(`Connected as "${base.clientName}". ${access}`, base);
  // Demo mode only: the in-memory access log, copied field by field like everything else.
  const data = {
    ...base,
    demo: true,
    persona: str(o.persona, 200),
    accessLog: arr(o.accessLog).map((e) => {
      const l = obj(e);
      return {
        at: str(l.at, 40),
        action: str(l.action, 40),
        target: str(l.target, 120),
        scope: str(l.scope, 40),
        severity: l.severity === 'elevated' ? 'elevated' : 'normal',
        decision: l.decision === 'allow' ? 'allow' : 'deny',
        reason: str(l.reason, 40),
      };
    }),
  };
  return block(
    `DEMO MODE. Fictional data, not a real person: ${data.persona}. No account, no network. ` +
      `${access}${base.rawTextEnabled ? '' : ' Restart the server with --demo-raw to turn it on.'} ` +
      `accessLog lists this session's requests, newest first, allowed and denied, the same audit trail a real Nocturne user sees in the app.`,
    data,
  );
}
