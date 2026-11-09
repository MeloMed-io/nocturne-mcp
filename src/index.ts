#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
// Nocturne MCP server (stdio), read-only. Lets an MCP app read your Nocturne
// mood timeline, entry list and songs. Entry text only if you turn it on.
//
//   nocturne-mcp login                    paste a connector token from the app
//   nocturne-mcp login --email            email + password accounts (also for testing)
//   nocturne-mcp whoami                   show this connection and its permissions
//   nocturne-mcp grant journals:read:raw  turn on full entry text (email accounts, in a terminal)
//   nocturne-mcp revoke journals:read:raw turn it off again
//   nocturne-mcp logout                   revoke this connection and forget the token
//   nocturne-mcp                          run the MCP server on stdio
//   nocturne-mcp --demo                   run it on a fictional journal, no account or network
//                                         (or NOCTURNE_DEMO=1). Add --demo-raw to allow entry text.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createInterface } from 'node:readline';
import { hostname } from 'node:os';
import { NocturneApi, NocturneError, signInWithPassword } from './api.ts';
import { TOKEN_PATTERN, apiUrl, clearSession, readSession, supabaseConfig, writeSession, SESSION_FILE } from './config.ts';
import { buildServer } from './server.ts';
import { DemoSource } from './demo/source.ts';

const RAW = 'journals:read:raw';
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const api = (token = readSession()?.token ?? null) => new NocturneApi(apiUrl(), token);

// Where the app's connection screen lives.
const APP_PATH = 'Nocturne > Settings > Privacy & Security > Connected apps';

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    }),
  );
}

const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

async function replaceSession(token: string, via: 'app' | 'email') {
  const old = readSession();
  if (old && old.token !== token) {
    // One connection per machine. Turn the old one off so it doesn't linger in the app's list.
    await api(old.token).revokeSelf().catch(() => {});
  }
  writeSession({ token, via, savedAt: new Date().toISOString() });
}

async function loginWithToken() {
  console.log(`In the Nocturne app, open ${APP_PATH} and create a connection, then copy its token.`);
  const token = process.env.NOCTURNE_MCP_TOKEN || (await ask('Connector token: ', true));
  if (!TOKEN_PATTERN.test(token)) {
    console.error('That does not look like a Nocturne connector token (it starts with noct_mcp_).');
    process.exit(1);
  }
  const who = await api(token).whoami();
  await replaceSession(token, 'app');
  console.log(`Connected as "${who.clientName}" with ${who.scopes.join(', ')}. Saved to ${SESSION_FILE}.`);
}

async function loginWithEmail() {
  const cfg = supabaseConfig();
  if (!cfg) {
    console.error('Email login is not available in this build. Use `nocturne-mcp login` with a token from the app.');
    process.exit(1);
  }
  const email = process.env.NOCTURNE_EMAIL || (await ask('Nocturne email: '));
  const password = process.env.NOCTURNE_PASSWORD || (await ask('Password: ', true));
  const jwt = await signInWithPassword(cfg, email, password);
  // The JWT is used for this one request and never written to disk.
  const { token, grant } = await api(null).createGrant(jwt, `nocturne-mcp on ${hostname()}`.slice(0, 80));
  await replaceSession(token, 'email');
  console.log(`Connected with ${grant.scopes.join(', ')}. Full entry text is off. Saved to ${SESSION_FILE}.`);
}

async function grantRaw(scope: string | undefined) {
  if (scope !== RAW) {
    console.error(`Usage: nocturne-mcp grant ${RAW}`);
    process.exit(1);
  }
  const session = readSession();
  if (!session) {
    console.error('Not connected. Run `nocturne-mcp login` first.');
    process.exit(1);
  }
  if (session.via === 'app') {
    console.log(`Turn on full entry text for this connection in the app: ${APP_PATH}.`);
    return;
  }
  // Widening access has to be a person at a keyboard who knows the password.
  // No env vars and no piped input, so an AI app with shell access can't do it.
  if (!interactive()) {
    console.error('This has to be run by you in an interactive terminal.');
    process.exit(1);
  }
  const cfg = supabaseConfig();
  if (!cfg) {
    console.error('Email login is not available in this build.');
    process.exit(1);
  }
  console.log('This lets the connected AI app read the full text of your entries. Every read is logged.');
  const email = await ask('Nocturne email: ');
  const password = await ask('Password: ', true);
  const jwt = await signInWithPassword(cfg, email, password);
  const who = await api(session.token).whoami();
  if (who.rawTextEnabled) return console.log('Full entry text is already on for this connection.');
  const { grant } = await api(null).setScopes(jwt, who.grantId, [...who.scopes, RAW]);
  console.log(`Full entry text is on. Scopes: ${grant.scopes.join(', ')}. Turn it off with \`nocturne-mcp revoke ${RAW}\`.`);
}

async function revokeRaw(scope: string | undefined) {
  if (scope !== RAW) {
    console.error(`Usage: nocturne-mcp revoke ${RAW}`);
    process.exit(1);
  }
  const who = await api().whoami();
  if (!who.rawTextEnabled) return console.log('Full entry text is already off.');
  const { scopes } = await api().narrow([RAW]);
  console.log(`Full entry text is off. Scopes: ${scopes.join(', ')}.`);
}

function runDemo(raw: boolean) {
  const tz = localTz();
  const source = new DemoSource({ tz, raw });
  console.error(
    `nocturne-mcp demo mode: fictional journal of Maya Chen (${source.journal.length} entries), no account, no network. ` +
      `Full entry text ${raw ? 'ON (--demo-raw)' : 'off, add --demo-raw to allow it'}.`,
  );
  return buildServer(() => source, tz, { demo: true }).connect(new StdioServerTransport());
}

async function main() {
  const args = process.argv.slice(2);
  const demoRaw = args.includes('--demo-raw');
  const demo = demoRaw || args.includes('--demo') || ['1', 'true'].includes(process.env.NOCTURNE_DEMO ?? '');
  const [cmd, arg] = args.filter((a) => a !== '--demo' && a !== '--demo-raw');
  if (demo) {
    if (cmd !== undefined) {
      console.error('--demo only runs the MCP server. Drop it to use login, whoami, grant, revoke or logout.');
      process.exit(1);
    }
    return runDemo(demoRaw);
  }
  switch (cmd) {
    case 'login':
      return arg === '--email' ? loginWithEmail() : loginWithToken();
    case 'whoami': {
      if (!readSession()) return console.log('Not connected.');
      const w = await api().whoami();
      return console.log(`"${w.clientName}": ${w.scopes.join(', ')}. Full entry text ${w.rawTextEnabled ? 'ON' : 'off'}.`);
    }
    case 'grant':
      return grantRaw(arg);
    case 'revoke':
      return revokeRaw(arg);
    case 'logout': {
      const s = readSession();
      if (s) await api(s.token).revokeSelf().catch(() => {});
      clearSession();
      return console.log('Disconnected. The token no longer works.');
    }
    case undefined:
      return buildServer(() => api(), localTz()).connect(new StdioServerTransport());
    default:
      console.error('Commands: login [--email] | whoami | grant journals:read:raw | revoke journals:read:raw | logout | --demo [--demo-raw]');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof NocturneError ? e.message : e);
  process.exit(1);
});
