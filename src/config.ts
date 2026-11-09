// Where the server talks to, and where it keeps its one secret (the connector
// token). The npm build bakes in the API URL and Nocturne's publishable
// Supabase key (the same values every copy of the app ships with). Running from
// source reads them from the env.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

declare const __NOCTURNE_API_URL__: string | undefined;
declare const __NOCTURNE_SUPABASE_URL__: string | undefined;
declare const __NOCTURNE_SUPABASE_KEY__: string | undefined;
const BUILT_API = typeof __NOCTURNE_API_URL__ === 'string' ? __NOCTURNE_API_URL__ : undefined;
const BUILT_SB_URL = typeof __NOCTURNE_SUPABASE_URL__ === 'string' ? __NOCTURNE_SUPABASE_URL__ : undefined;
const BUILT_SB_KEY = typeof __NOCTURNE_SUPABASE_KEY__ === 'string' ? __NOCTURNE_SUPABASE_KEY__ : undefined;

export const DEFAULT_API_URL = 'https://melomed-ios-m.onrender.com/api';

export function apiUrl(): string {
  return (process.env.NOCTURNE_API_URL ?? BUILT_API ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

/** Only needed for `login --email`. Null when this build has no publishable key. */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NOCTURNE_SUPABASE_URL ?? (BUILT_SB_URL || undefined);
  const key = process.env.NOCTURNE_SUPABASE_ANON_KEY ?? (BUILT_SB_KEY || undefined);
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

// ---------------------------------------------------------------- session file

export const CONFIG_DIR = process.env.NOCTURNE_MCP_HOME ?? join(homedir(), '.config', 'nocturne-mcp');
export const SESSION_FILE = join(CONFIG_DIR, 'session.json');

export interface Session {
  /** Connector token (noct_mcp_...). Read-only, scoped, revocable from the app. */
  token: string;
  /** How it was obtained. "email" can widen scopes from the CLI, "app" can't. */
  via: 'app' | 'email';
  savedAt: string;
}

export function readSession(): Session | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Session;
    return typeof s.token === 'string' && s.token ? s : null;
  } catch {
    return null;
  }
}

export function writeSession(s: Session): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies when the file is created.
  chmodSync(SESSION_FILE, 0o600);
}

export function clearSession(): void {
  rmSync(SESSION_FILE, { force: true });
}

export const TOKEN_PATTERN = /^noct_mcp_[A-Za-z0-9_-]{43}$/;
