# Nocturne MCP

Read-only connector between Nocturne, the journaling app, and AI apps that support MCP: Claude Desktop, Claude Code, Cursor, Codex and others.

Connect your own Nocturne account, or try it first on a fictional demo journal with no account at all.

By default a connected app can see your mood timeline, the dates and mood labels of your entries, and the songs attached to them. It can't see what you wrote. Full entry text stays off unless you turn it on yourself. Every request, allowed or refused, is logged and shown back to you in Nocturne.

Guide: https://melomed.io/developers/nocturne

Requires Node.js 20 or newer.

## Demo mode

No account and no network. The server serves a built-in fictional journal: Maya Chen, a made-up college sophomore, about 30 entries over the last 42 days, dated relative to when the server starts in your local time zone. Nothing is real and nothing leaves your computer.

Demo mode runs the same permission checks and output filtering as a real connection:

- `get_mood_timeline`, `list_entries` and `list_songs` work. They never return what Maya wrote.
- `get_entry_text` is refused, the same way it is for a real connection that hasn't turned on full entry text. Start the server with `--demo-raw` to allow it.
- Every request, allowed or refused, goes into an in-memory access log. `get_connection_info` returns it under `accessLog`.

Claude Code:

```sh
claude mcp add nocturne-demo -s user -- npx -y nocturne-mcp --demo
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`~/.cursor/mcp.json`) and other apps that use `mcpServers` JSON:

```json
{
  "mcpServers": {
    "nocturne-demo": { "command": "npx", "args": ["-y", "nocturne-mcp", "--demo"] }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.nocturne-demo]
command = "npx"
args = ["-y", "nocturne-mcp", "--demo"]
```

Restart the app after editing its config. To allow full entry text, add `"--demo-raw"` after `"--demo"`. Setting `NOCTURNE_DEMO=1` also turns on demo mode.

### The demo journal

| Days before today | What happens |
|---|---|
| 24 to 21 | Stressed and anxious before a CHEM 201 midterm on day 21, relief after |
| 10 to 8 | A rough patch: missed tasks and a fight with her roommate |
| 3 to 2 | BIO 210 lab report due, finished a day late |
| last 3 days | A little anxious, CHEM 201 exam 2 is 4 days from today |
| Tuesdays, Thursdays, Sundays | Climbing nights and long runs, calmer and happier days |

The same student and dates are in the 2DooD demo (`npx -y 2dood-mcp --demo`), so you can line her tasks up against her moods.

## Your own journal

You need a Nocturne account (Apple, Google or email sign-in). Guest accounts can't connect apps.

### 1. Connect once

```sh
npx -y nocturne-mcp login
```

In Nocturne, open Settings > Privacy & Security > Connected apps, create a connection, and paste the token it shows you. The token is shown once. It is saved to `~/.config/nocturne-mcp/session.json`, readable only by you. Your Nocturne password and session are never stored.

If your account uses email and password you can skip the app:

```sh
npx -y nocturne-mcp login --email
```

Other commands:

```sh
npx -y nocturne-mcp whoami    # this connection and what it can read
npx -y nocturne-mcp logout    # turn the connection off and forget the token
```

You can also remove any connection from the app. It stops working on the next request.

### 2. Add it to your AI app

Claude Code:

```sh
claude mcp add nocturne -s user -- npx -y nocturne-mcp
```

Claude Desktop, Cursor and other apps that use `mcpServers` JSON:

```json
{
  "mcpServers": {
    "nocturne": { "command": "npx", "args": ["-y", "nocturne-mcp"] }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.nocturne]
command = "npx"
args = ["-y", "nocturne-mcp"]
```

Restart the app after editing its config.

## Tools

All tools are read-only. There are no write tools in this version.

| Tool | Permission | What it returns |
|---|---|---|
| `get_mood_timeline` | `moods:read` | Per day or week: entry count, average valence and arousal, top emotion labels, and whether valence is rising, falling or steady |
| `list_entries` | `entries:read` | Entry ids, dates, times, mood label and numbers, whether songs or a drawing are attached. Never the text |
| `list_songs` | `songs:read` | The song picked for each entry and the songs Nocturne suggested, title and artist only |
| `get_entry_text` | `journals:read:raw` | The full text and bullets of one entry. Off by default |
| `get_connection_info` | none | Which permissions this connection has (in demo mode, also its access log) |

New connections get `moods:read`, `entries:read` and `songs:read` unless you change them. Never anything that reads what you wrote.

## Full entry text

`journals:read:raw` is a separate permission. No other permission includes it, and a connection can't give it to itself.

- In the app: Settings > Privacy & Security > Connected apps, pick the connection, turn on full entry text. This works for every account type.
- Email accounts can also run `npx -y nocturne-mcp grant journals:read:raw` themselves in a terminal. It asks for your password again and refuses to run when nobody is at the keyboard, so an AI app with terminal access can't switch it on.

Turn it off any time, from the app or with:

```sh
npx -y nocturne-mcp revoke journals:read:raw
```

Reads of entry text are marked as elevated in your access log in the app.

Mood labels are automatic reads of the writing and can be wrong. Nocturne is a journaling app, not therapy, and the server tells AI apps not to treat moods as a diagnosis.

## Privacy

The server runs on your computer and talks to the Nocturne API with a token that only works for your account and only for the permissions you chose. Nocturne checks those permissions on its server for every request, so changing this program can't widen them. What you share with an AI app is handled under that app's privacy policy.

Not shared, whatever the permissions: Health app (State of Mind) data, safety flags, themes extracted from your writing, and the reasons Nocturne gives for its song picks (they can quote your entry).

## Develop

```sh
npm install
npm test                 # node --test, fake fetch and demo data, no network
npm run dev -- --demo    # run from source on the demo journal
npm run build            # one-file bundle in dist/
```

Environment overrides: `NOCTURNE_DEMO=1` (demo mode), `NOCTURNE_API_URL`, `NOCTURNE_SUPABASE_URL` and `NOCTURNE_SUPABASE_ANON_KEY` (publishable key, only for `login --email`), `NOCTURNE_MCP_HOME` (session folder), `NOCTURNE_MCP_TOKEN` (non-interactive `login`).

`src/vendor/mcp-consent-audit/` is a copy of [mcp-consent-audit](https://github.com/candpixie/mcp-consent-audit) (MIT), the consent and access log library the connector uses.

## License

MIT. The Nocturne name is a trademark of MeloMed, Inc. and is not covered by the license.
