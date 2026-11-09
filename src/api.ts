// HTTP client for the Nocturne backend's /api/mcp routes. The backend does the
// real work: it checks the connector token's scopes with mcp-consent-audit
// before any query, writes the access log, and decrypts entry text only for
// journals:read:raw. This file just calls it and turns failures into messages
// an AI app can relay to the person.

export type Fetch = typeof fetch;

export class NocturneError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'NocturneError';
    this.code = code;
    this.status = status;
  }
}

const NOT_SIGNED_IN = 'Not connected to Nocturne. Run `npx -y nocturne-mcp login` in a terminal once, then retry.';

/** Human-readable meaning of each backend error code. */
export function explain(code: string, status: number, required?: string): string {
  switch (code) {
    case 'missing_token':
    case 'invalid_token':
      return NOT_SIGNED_IN;
    case 'revoked_grant':
      return 'This connection was turned off in Nocturne. Run `npx -y nocturne-mcp login` to connect again.';
    case 'missing_scope':
      return required === 'journals:read:raw'
        ? 'Reading full entry text is off for this connection. Only the person can turn it on, in the Nocturne app ' +
            '(or with `npx -y nocturne-mcp grant journals:read:raw` for email accounts). Do not ask them more than once.'
        : `This connection doesn't include ${required ?? 'that permission'}. The person can change it in the Nocturne app.`;
    default:
      if (status === 404) return 'Not found. The entry may have been deleted, or the id is wrong.';
      if (status === 429) return 'Nocturne is rate limiting requests. Wait a minute and retry.';
      if (status >= 500) return 'Nocturne had a server problem. Try again shortly.';
      return code || `Request failed (${status}).`;
  }
}

export interface RangeArgs {
  from?: string;
  to?: string;
  tz: string;
}

export interface Whoami {
  grantId: string;
  clientName: string;
  scopes: string[];
  grantedAt: string;
  rawTextEnabled: boolean;
}

/**
 * What the MCP tools read from. NocturneApi talks to the backend over HTTP.
 * DemoSource (src/demo/source.ts) serves a fictional journal from memory
 * through the same scope checks and shaping, with no network.
 */
export interface NocturneSource {
  whoami(): Promise<Whoami>;
  moods(a: RangeArgs & { bucket?: 'day' | 'week' }): Promise<unknown>;
  entries(a: RangeArgs & { emotion?: string; limit?: number; offset?: number }): Promise<unknown>;
  songs(a: RangeArgs & { limit?: number }): Promise<unknown>;
  entryText(id: string, tz: string): Promise<unknown>;
}

export class NocturneApi implements NocturneSource {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: Fetch;
  constructor(baseUrl: string, token: string | null, fetchImpl: Fetch = fetch) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; required?: string; auth?: string } = {},
  ): Promise<T> {
    const auth = opts.auth ?? this.token;
    if (!auth) throw new NocturneError(NOT_SIGNED_IN, 'missing_token', 401);
    const url = new URL(`${this.baseUrl}/mcp${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          Accept: 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new NocturneError(
        `Couldn't reach Nocturne (${(e as Error).name === 'TimeoutError' ? 'timed out, the server may be waking up, retry once' : 'network error'}).`,
        'network',
        0,
      );
    }
    let json: { success?: boolean; data?: T; error?: string } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || json.success === false) {
      const code = typeof json.error === 'string' ? json.error : '';
      throw new NocturneError(explain(code, res.status, opts.required), code || `http_${res.status}`, res.status);
    }
    return json.data as T;
  }

  whoami() {
    return this.call<Whoami>('GET', '/v1/whoami');
  }

  moods(a: RangeArgs & { bucket?: 'day' | 'week' }) {
    return this.call<unknown>('GET', '/v1/moods', { query: { ...a }, required: 'moods:read' });
  }

  entries(a: RangeArgs & { emotion?: string; limit?: number; offset?: number }) {
    return this.call<unknown>('GET', '/v1/entries', { query: { ...a }, required: 'entries:read' });
  }

  songs(a: RangeArgs & { limit?: number }) {
    return this.call<unknown>('GET', '/v1/songs', { query: { ...a }, required: 'songs:read' });
  }

  entryText(id: string, tz: string) {
    return this.call<unknown>('GET', `/v1/entries/${encodeURIComponent(id)}/text`, {
      query: { tz },
      required: 'journals:read:raw',
    });
  }

  revokeSelf() {
    return this.call<{ revoked: boolean }>('POST', '/v1/revoke-self', { body: {} });
  }

  narrow(remove: string[]) {
    return this.call<{ scopes: string[] }>('POST', '/v1/narrow', { body: { remove } });
  }

  // ---- user-JWT routes, used only by `login --email` and `grant` ----

  createGrant(jwt: string, clientName: string, scopes?: string[]) {
    return this.call<{ grant: { id: string; scopes: string[] }; token: string }>('POST', '/grants', {
      auth: jwt,
      body: { clientName, ...(scopes ? { scopes } : {}) },
    });
  }

  setScopes(jwt: string, grantId: string, scopes: string[]) {
    return this.call<{ grant: { id: string; scopes: string[] } }>('PUT', `/grants/${encodeURIComponent(grantId)}`, {
      auth: jwt,
      body: { scopes },
    });
  }
}

/** Email + password sign-in against Supabase Auth. Returns a short-lived JWT that is never saved. */
export async function signInWithPassword(
  cfg: { url: string; key: string },
  email: string,
  password: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; msg?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.msg ?? `sign-in failed (${res.status})`);
  }
  return json.access_token;
}
