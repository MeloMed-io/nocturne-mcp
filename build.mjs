// Bundles the server into one file for npm, so users need Node 20+ and nothing
// else.
//
// Baked in at build time:
//   API URL         NOCTURNE_API_URL, else the live Nocturne API
//   Supabase URL    NOCTURNE_SUPABASE_URL (optional)
//   publishable key NOCTURNE_SUPABASE_ANON_KEY (optional)
// The Supabase pair is only used by `login --email`. If it's missing the build
// still works and email login says it isn't available. Never a secret key.
import { build } from 'esbuild';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const apiUrl = process.env.NOCTURNE_API_URL ?? 'https://melomed-ios-m.onrender.com/api';
const supabaseUrl = process.env.NOCTURNE_SUPABASE_URL ?? '';
const anonKey = process.env.NOCTURNE_SUPABASE_ANON_KEY ?? '';

if (!/^https:\/\//.test(apiUrl)) throw new Error(`API URL must be https: ${apiUrl}`);
if (anonKey) {
  if (anonKey.startsWith('sb_secret_') || anonKey.includes('service_role')) {
    throw new Error('refusing to bundle a secret key');
  }
  if (anonKey.startsWith('eyJ')) {
    const payload = JSON.parse(Buffer.from(anonKey.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}');
    if (payload.role !== 'anon') throw new Error(`refusing to bundle a key with role "${payload.role}"`);
  } else if (!anonKey.startsWith('sb_publishable_')) {
    throw new Error('unexpected key format');
  }
}

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  legalComments: 'inline',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  define: {
    __PKG_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
    __NOCTURNE_API_URL__: JSON.stringify(apiUrl),
    __NOCTURNE_SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __NOCTURNE_SUPABASE_KEY__: JSON.stringify(anonKey),
  },
});

// esbuild keeps the source's dev hashbang, swap it for a portable one.
const out = readFileSync('dist/index.js', 'utf8').replace(/^#![^\n]*\n/, '#!/usr/bin/env node\n');
writeFileSync('dist/index.js', out);
chmodSync('dist/index.js', 0o755);
console.log(`built dist/index.js (api ${apiUrl}, email login ${anonKey ? 'on' : 'off'})`);
