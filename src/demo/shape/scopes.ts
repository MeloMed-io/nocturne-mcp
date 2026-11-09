// Scopes a Nocturne MCP connector token can carry.
//
// Only these four exist. Wildcards ("*", "journals:*") are never accepted when
// a grant is created or edited, so the vendored library's wildcard matching
// can't be reached from user input.

export const SCOPES = {
  /** Mood timeline: emotion labels, valence, arousal, trend. No text. */
  MOODS_READ: 'moods:read',
  /** Entry list: ids, dates, mood labels. No text. */
  ENTRIES_READ: 'entries:read',
  /** Songs attached to entries: track name and artist only. */
  SONGS_READ: 'songs:read',
  /** Full journal text. Elevated, off unless the user turns it on. */
  JOURNALS_READ_RAW: 'journals:read:raw',
} as const;

export type NocturneScope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: readonly NocturneScope[] = Object.values(SCOPES);

/** What a new connection gets unless the user picks otherwise. Never includes raw text. */
export const DEFAULT_SCOPES: readonly NocturneScope[] = [
  SCOPES.MOODS_READ,
  SCOPES.ENTRIES_READ,
  SCOPES.SONGS_READ,
];

export const ELEVATED_SCOPES: ReadonlySet<string> = new Set([SCOPES.JOURNALS_READ_RAW]);

/** Keeps known scopes only, deduped, in a stable order. Throws on anything else. */
export function normalizeScopes(input: readonly string[]): NocturneScope[] {
  const unknown = input.filter((s) => !(ALL_SCOPES as readonly string[]).includes(s));
  if (unknown.length) {
    throw new Error(`Unknown scope(s): ${unknown.join(', ')}`);
  }
  return ALL_SCOPES.filter((s) => input.includes(s));
}
