// Output shaping for the MCP connector. Pure functions.
//
// The rule these enforce: default-scope responses are built field by field
// from an allowlist, so nothing outside it can leak by accident. Only
// shapeEntryText ever returns journal text, and only the full-text scope
// reaches it.

export type Bucket = 'day' | 'week';

/** One row per live entry, as selected by mcp.repository. */
export interface MoodRow {
  id: string;
  created_at: Date | string;
  primary_emotion: string | null;
  valence: number | string | null;
  arousal: number | string | null;
  /** nlp_analyses.emotions: [{emotion, intensity, ...}] */
  emotions?: unknown;
  has_songs?: boolean | null;
  has_drawing?: boolean | null;
}

export interface SongRow {
  id: string;
  created_at: Date | string;
  seed_track: unknown;
  tracks: unknown;
}

export interface MoodPoint {
  date: string;
  entries: number;
  avgValence: number;
  avgArousal: number;
  topEmotions: string[];
}

export interface MoodTimeline {
  from: string;
  to: string;
  timezone: string;
  bucket: Bucket;
  points: MoodPoint[];
  trend: { valence: 'rising' | 'falling' | 'steady' | 'not_enough_data'; changePerWeek: number | null };
  entriesWithMood: number;
  entriesWithoutMood: number;
}

export interface EntrySummary {
  id: string;
  date: string;
  time: string;
  mood: { primaryEmotion: string; valence: number | null; arousal: number | null } | null;
  hasSongs: boolean;
  hasDrawing: boolean;
}

export interface EntrySongs {
  entryId: string;
  date: string;
  picked: { title: string; artist: string } | null;
  playlist: Array<{ title: string; artist: string }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Plain short label, or null. Caps length so a malformed value can't carry a paragraph. */
function label(v: unknown, max = 60): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Emotion labels are one or two words ("joy", "anticipation", "low energy").
 * Anything longer or with punctuation is dropped, so a label slot can never
 * carry a sentence of free text.
 */
const EMOTION_LABEL = /^[A-Za-z][A-Za-z_-]*( [A-Za-z][A-Za-z_-]*)?$/;
export function emotionLabel(v: unknown): string | null {
  const s = label(v, 30);
  return s && s.length < 30 && EMOTION_LABEL.test(s) ? s.toLowerCase() : null;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD and HH:MM of an instant in a time zone. */
export function localParts(at: Date | string, timeZone: string): { date: string; time: string } {
  const d = at instanceof Date ? at : new Date(at);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** The UTC instant of local midnight at the start of a YYYY-MM-DD date in a time zone. */
export function zonedMidnightUtc(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const p = localParts(new Date(t), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number);
    const [hh, mm] = p.time.split(':').map(Number);
    return Date.UTC(py, pm - 1, pd, hh, mm) - t;
  };
  let t = guess - offsetAt(guess);
  // Second pass settles DST days, where the offset at the guess differs from the offset at midnight.
  t = guess - offsetAt(t);
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

function emotionLabels(emotions: unknown): string[] {
  if (!Array.isArray(emotions)) return [];
  const out: Array<{ name: string; w: number }> = [];
  for (const e of emotions) {
    if (!e || typeof e !== 'object') continue;
    const name = emotionLabel((e as Record<string, unknown>).emotion);
    if (!name) continue;
    out.push({ name, w: num((e as Record<string, unknown>).intensity) ?? 0 });
  }
  return out.sort((a, b) => b.w - a.w).map((e) => e.name);
}

/**
 * Least-squares slope of average valence against days, scaled to per week.
 * Needs three or more buckets. Under 0.05 a week counts as steady.
 */
export function valenceTrend(points: MoodPoint[]): MoodTimeline['trend'] {
  if (points.length < 3) return { valence: 'not_enough_data', changePerWeek: null };
  const xs = points.map((p) => daysBetween(points[0].date, p.date));
  const ys = points.map((p) => p.avgValence);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return { valence: 'not_enough_data', changePerWeek: null };
  const perWeek = round2((sxy / sxx) * 7);
  const valence = Math.abs(perWeek) < 0.05 ? 'steady' : perWeek > 0 ? 'rising' : 'falling';
  return { valence, changePerWeek: perWeek };
}

export function shapeMoodTimeline(
  rows: MoodRow[],
  opts: { from: string; to: string; timezone: string; bucket: Bucket },
): MoodTimeline {
  type Group = { v: number[]; a: number[]; counts: Map<string, number> };
  const groups = new Map<string, Group>();
  let without = 0;
  for (const r of rows) {
    const valence = num(r.valence);
    const primary = emotionLabel(r.primary_emotion);
    if (valence === null || !primary) {
      without++;
      continue;
    }
    const { date } = localParts(r.created_at, opts.timezone);
    const key = opts.bucket === 'week' ? weekStart(date) : date;
    const g: Group = groups.get(key) ?? { v: [], a: [], counts: new Map<string, number>() };
    g.v.push(valence);
    const arousal = num(r.arousal);
    if (arousal !== null) g.a.push(arousal);
    // Primary emotion counts 1, the next two strongest count 0.5 each.
    g.counts.set(primary, (g.counts.get(primary) ?? 0) + 1);
    for (const n of emotionLabels(r.emotions).filter((n) => n !== primary).slice(0, 2)) {
      g.counts.set(n, (g.counts.get(n) ?? 0) + 0.5);
    }
    groups.set(key, g);
  }

  const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const points: MoodPoint[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, g]) => ({
      date,
      entries: g.v.length,
      avgValence: avg(g.v),
      avgArousal: avg(g.a),
      topEmotions: [...g.counts.entries()]
        .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
        .slice(0, 3)
        .map(([n]) => n),
    }));

  return {
    from: opts.from,
    to: opts.to,
    timezone: opts.timezone,
    bucket: opts.bucket,
    points,
    trend: valenceTrend(points),
    entriesWithMood: rows.length - without,
    entriesWithoutMood: without,
  };
}

export function shapeEntryList(rows: MoodRow[], timezone: string): EntrySummary[] {
  return rows.map((r) => {
    const { date, time } = localParts(r.created_at, timezone);
    const primary = emotionLabel(r.primary_emotion);
    const valence = num(r.valence);
    const arousal = num(r.arousal);
    return {
      id: String(r.id),
      date,
      time,
      mood: primary
        ? { primaryEmotion: primary, valence: valence === null ? null : round2(valence), arousal: arousal === null ? null : round2(arousal) }
        : null,
      hasSongs: r.has_songs === true,
      hasDrawing: r.has_drawing === true,
    };
  });
}

function track(v: unknown): { title: string; artist: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const title = label(o.name, 200) ?? label(o.title, 200);
  const artist =
    label(o.artist, 200) ??
    (Array.isArray(o.artists) ? label(o.artists.find((a) => typeof a === 'string'), 200) : null);
  if (!title || !artist) return null;
  return { title, artist };
}

export function shapeSongs(rows: SongRow[], timezone: string): EntrySongs[] {
  return rows
    .map((r) => ({
      entryId: String(r.id),
      date: localParts(r.created_at, timezone).date,
      picked: track(r.seed_track),
      playlist: (Array.isArray(r.tracks) ? r.tracks : []).map(track).filter((t): t is { title: string; artist: string } => t !== null),
    }))
    .filter((e) => e.picked || e.playlist.length);
}

/** The only shaper that returns journal text. Raw-scope route only. */
export function shapeEntryText(
  entry: { id: string; created_at: Date | string; text: string },
  timezone: string,
): { id: string; date: string; time: string; text: string } {
  const { date, time } = localParts(entry.created_at, timezone);
  return { id: entry.id, date, time, text: entry.text };
}
