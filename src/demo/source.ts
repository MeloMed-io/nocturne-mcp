// Demo mode: the backend's /api/mcp/v1 routes, run in memory against a
// fictional journal. No account, no network, nothing written to disk.
//
// It goes through the same steps as real mode so people learn the real
// permission model:
//   1. authorize() from mcp-consent-audit checks the scope and records every
//      allow and deny.
//   2. The shaping functions in ./shape build the response from an allowlist,
//      the same way real responses are built.
//   3. server.ts then runs the result through format.ts, the same local
//      allowlist real mode uses.
import { randomUUID } from 'node:crypto';
import { NocturneError, explain, type NocturneSource, type RangeArgs, type Whoami } from '../api.ts';
import { authorize } from '../vendor/mcp-consent-audit/authorize.ts';
import { ConsentError } from '../vendor/mcp-consent-audit/errors.ts';
import { InMemoryAuditSink, InMemoryGrantStore } from '../vendor/mcp-consent-audit/stores/memory.ts';
import type { ActionType, Grant, Severity } from '../vendor/mcp-consent-audit/types.ts';
import { DEFAULT_SCOPES, ELEVATED_SCOPES, SCOPES } from './shape/scopes.ts';
import {
  addDays,
  daysBetween,
  isValidTimeZone,
  localParts,
  shapeEntryList,
  shapeEntryText,
  shapeMoodTimeline,
  shapeSongs,
  zonedMidnightUtc,
} from './shape/shape.ts';
import { DEMO_PERSONA, seedDemo, type DemoEntry } from './seed.ts';

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const TIMELINE_ROW_CAP = 2000;
const ACCESS_LOG_SHOWN = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const DEMO_RAW_HINT = 'Demo mode: restart the server with --demo-raw to turn full entry text on for the fictional journal.';

export interface DemoOptions {
  /** Clock the journal is seeded from. Default: now. */
  now?: Date;
  tz: string;
  /** Adds journals:read:raw to the demo connection. Off by default, like a real one. */
  raw?: boolean;
}

export interface DemoWhoami extends Whoami {
  demo: true;
  persona: string;
  accessLog: Array<{
    at: string;
    action: string;
    target: string;
    scope: string | null;
    severity: string;
    decision: 'allow' | 'deny';
    reason: string | null;
  }>;
}

const bad = (message: string) => new NocturneError(message, message, 400);

export class DemoSource implements NocturneSource {
  readonly journal: DemoEntry[];
  readonly audit = new InMemoryAuditSink();
  private readonly store = new InMemoryGrantStore();
  private readonly grant: Grant;
  // Lives only in this process. It stands in for the connector token so the
  // demo walks the same token, grant, scope path as real mode.
  private readonly token = `noct_mcp_demo_${randomUUID()}`;

  constructor(opts: DemoOptions) {
    const now = opts.now ?? new Date();
    this.journal = seedDemo(now, opts.tz);
    this.grant = {
      id: '4d415941-0000-4000-8000-00000000d3e0',
      userId: 'demo-maya-chen',
      clientName: 'nocturne-mcp demo',
      scopes: opts.raw ? [...DEFAULT_SCOPES, SCOPES.JOURNALS_READ_RAW] : [...DEFAULT_SCOPES],
      purpose: 'demo with fictional data',
      grantedAt: now,
    };
    this.store.add(this.grant, this.token);
  }

  /** Same gate as the backend's requireScope(). Denials come back with real mode's wording. */
  private async gate(required: string, action: ActionType, target: string, severity: Severity = 'normal') {
    try {
      return await authorize(
        { store: this.store, audit: this.audit },
        { token: this.token, required, action, target, severity, requestId: randomUUID() },
      );
    } catch (e) {
      if (!(e instanceof ConsentError)) throw e;
      // Raw text gets demo wording: the real one points at the app and `grant`, which don't apply here.
      const message =
        e.reason === 'missing_scope' && required === SCOPES.JOURNALS_READ_RAW
          ? `Reading full entry text is off for this connection. With a real account only the person can turn it on, in the Nocturne app. ${DEMO_RAW_HINT} Do not ask them more than once.`
          : explain(e.reason, e.status, required);
      throw new NocturneError(message, e.reason, e.status);
    }
  }

  /** Mirrors resolveRange() in mcp.routes.ts. */
  private range(a: RangeArgs) {
    if ((a.from && !YMD.test(a.from)) || (a.to && !YMD.test(a.to))) throw bad('use YYYY-MM-DD');
    const tz = a.tz || 'UTC';
    if (!isValidTimeZone(tz)) throw bad('unknown time zone');
    const to = a.to ?? localParts(new Date(), tz).date;
    const from = a.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) throw bad('invalid date');
    const span = daysBetween(from, to);
    if (span < 0) throw bad('from is after to');
    if (span >= MAX_RANGE_DAYS) throw bad(`range is limited to ${MAX_RANGE_DAYS} days`);
    return { tz, from, to, fromMs: zonedMidnightUtc(from, tz).getTime(), toMs: zonedMidnightUtc(addDays(to, 1), tz).getTime() };
  }

  /** Mirrors the repository: entries in [from, to), newest first. */
  private rows(r: { fromMs: number; toMs: number }, emotion?: string) {
    return this.journal
      .filter((e) => {
        const t = Date.parse(e.created_at);
        return t >= r.fromMs && t < r.toMs && (!emotion || e.primary_emotion?.toLowerCase() === emotion.toLowerCase());
      })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async whoami(): Promise<DemoWhoami> {
    // Like the backend's liveGrant(): no data scope needed, but the call is logged.
    await this.audit.record({
      userId: this.grant.userId,
      clientName: this.grant.clientName,
      action: 'tool.call',
      target: 'whoami',
      scopeUsed: null,
      severity: 'normal',
      decision: 'allow',
      reason: null,
      at: new Date(),
    });
    return {
      grantId: this.grant.id,
      clientName: this.grant.clientName,
      scopes: this.grant.scopes,
      grantedAt: this.grant.grantedAt.toISOString(),
      rawTextEnabled: this.grant.scopes.some((s) => ELEVATED_SCOPES.has(s)),
      demo: true,
      persona: DEMO_PERSONA,
      accessLog: (await this.audit.listForUser(this.grant.userId, { limit: ACCESS_LOG_SHOWN })).map((e) => ({
        at: e.at.toISOString(),
        action: e.action,
        target: e.target,
        scope: e.scopeUsed,
        severity: e.severity,
        decision: e.decision,
        reason: e.reason ?? null,
      })),
    };
  }

  async moods(a: RangeArgs & { bucket?: 'day' | 'week' }) {
    await this.gate(SCOPES.MOODS_READ, 'resource.read', 'nocturne://moods/timeline');
    const r = this.range(a);
    const rows = this.rows(r).slice(0, TIMELINE_ROW_CAP);
    const timeline = shapeMoodTimeline(rows, { from: r.from, to: r.to, timezone: r.tz, bucket: a.bucket === 'week' ? 'week' : 'day' });
    return { ...timeline, truncated: rows.length >= TIMELINE_ROW_CAP };
  }

  async entries(a: RangeArgs & { emotion?: string; limit?: number; offset?: number }) {
    await this.gate(SCOPES.ENTRIES_READ, 'resource.list', 'nocturne://entries');
    const r = this.range(a);
    const limit = Math.min(Math.max(Number(a.limit) || 50, 1), 200);
    const offset = Math.max(Number(a.offset) || 0, 0);
    const emotion = a.emotion?.trim().slice(0, 40) || undefined;
    const rows = this.rows(r, emotion).slice(offset, offset + limit + 1);
    return {
      from: r.from,
      to: r.to,
      timezone: r.tz,
      entries: shapeEntryList(rows.slice(0, limit), r.tz),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }

  async songs(a: RangeArgs & { limit?: number }) {
    await this.gate(SCOPES.SONGS_READ, 'resource.list', 'nocturne://songs');
    const r = this.range(a);
    const limit = Math.min(Math.max(Number(a.limit) || 50, 1), 200);
    const rows = this.rows(r)
      .filter((e) => e.seed_track || e.tracks)
      .slice(0, limit);
    return { from: r.from, to: r.to, timezone: r.tz, entries: shapeSongs(rows, r.tz) };
  }

  async entryText(id: string, tz: string) {
    // Validated before authorize() so the audit target is never junk, as in the route.
    if (!UUID.test(id)) throw bad('invalid id');
    await this.gate(SCOPES.JOURNALS_READ_RAW, 'resource.read', `nocturne://entries/${id}/text`, 'elevated');
    const zone = isValidTimeZone(tz) ? tz : 'UTC';
    const entry = this.journal.find((e) => e.id === id.toLowerCase());
    if (!entry) throw new NocturneError(explain('', 404), 'not found', 404);
    return { ...shapeEntryText(entry, zone), bullets: entry.bullets };
  }
}
