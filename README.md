# Live Web Chat

Localhost browser chat for [Claude Code](https://claude.com/claude-code) with
voice (Whisper STT + OpenAI TTS), structured permission previews, file uploads,
and inline HTML rendering in assistant messages.

Forked from [`anthropics/claude-plugins-official#external_plugins/fakechat`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat)
at commit `7994c270` and maintained independently.

## TL;DR

```
/plugin marketplace add refactor-ua/Live-Web-Chat
/plugin install live-web-chat@refactor-ua
/plugin install voice-skill@refactor-ua          # optional, enables auto-voice
exit
claude --dangerously-load-development-channels plugin:live-web-chat@refactor-ua
```

Open <http://localhost:8787>. Type. Claude replies in the browser.

## Prerequisites

| What | Why | Install |
| --- | --- | --- |
| [Claude Code](https://claude.com/claude-code) | the host CLI | `npm i -g @anthropic-ai/claude-code` |
| [Bun](https://bun.sh) ≥ 1.0 | plugin runtime (TypeScript) | <https://bun.sh/docs/installation> |
| OpenAI API key | only for voice (STT + TTS) | <https://platform.openai.com/api-keys> |

Voice is **optional** — without an `OPENAI_API_KEY` the chat still works (text
only). The mic button and `speak` tool will fail with a clear error.

## Install

Inside a running `claude` session:

```
/plugin marketplace add refactor-ua/Live-Web-Chat
/plugin install live-web-chat@refactor-ua
```

Optionally also install the companion skill for auto-routing voice → voice
replies (Telegram + this chat):

```
/plugin install voice-skill@refactor-ua
```

Exit Claude (`/exit`), then relaunch with the channels flag:

```sh
claude --dangerously-load-development-channels plugin:live-web-chat@refactor-ua
```

On startup the server prints its URL to stderr:

```
live-web-chat: http://localhost:8787
```

Open it in any browser. One tab, one user, no auth.

## OpenAI key for voice

Put your key in a `.env` file inside the installed plugin directory. The plugin
lives at:

```
~/.claude/plugins/cache/refactor-ua/live-web-chat/<version>/
```

Create `.env` there:

```
OPENAI_API_KEY=sk-...
```

(See `.env.example` for the format.)

A reinstall via `/plugin update` re-extracts the directory, so back up your
`.env` if you reinstall.

## Windows launcher (`.bat`)

Save this as e.g. `launch-claude.bat` on your desktop — double-click to start
Claude in your project with the chat already opening:

```bat
@echo off
cd /d C:\path\to\your\project
start chrome "http://localhost:8787/"
call claude --dangerously-load-development-channels plugin:live-web-chat@refactor-ua
pause
```

Adjust the `cd /d ...` line to point at the project directory you want Claude
working in. Chrome opens slightly before the server is ready — give it a moment
or hit reload.

## macOS / Linux launcher (`.sh`)

```sh
#!/usr/bin/env bash
cd ~/code/your-project
( sleep 2 && open http://localhost:8787 ) &           # macOS
# ( sleep 2 && xdg-open http://localhost:8787 ) &     # Linux
claude --dangerously-load-development-channels plugin:live-web-chat@refactor-ua
```

`chmod +x launch-claude.sh`, then run it from a terminal or a desktop shortcut.

## Configuration

- **Port** — `LIVE_WEB_CHAT_PORT=9000` in `.env` (default `8787`).
- **Runtime config** — `~/.claude/channels/live-web-chat/config.json` (created
  on first run; UI exposes mode, TTS voice/speed, language, etc.).
- **Listen mode** — `PTT` (push-to-talk) / `Confirmation` / `On-Completion` /
  `Always` / `Off`. Change in the UI's Settings panel.

## What Claude can do

| Tool | Purpose |
| --- | --- |
| `reply` | Send a message to the UI. Takes `text`, optionally `reply_to` (message ID) and `files` (absolute paths, ≤50 MB each). |
| `speak` | Stream a TTS audio reply to the browser (OpenAI TTS). |
| `edit_message` | Edit a previously-sent message in place. |

Inbound images/files save to `~/.claude/channels/live-web-chat/inbox/`.
Outbound files are copied to `outbox/` and served over HTTP.

## Inline HTML in assistant messages

The UI renders this allowlist inline:

`<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` (with `colspan` /
`rowspan`), `<ul>`, `<ol>`, `<li>`, `<code>`, `<pre>`, `<b>` / `<strong>`,
`<i>` / `<em>`, `<br>`, `<hr>`, `<p>`.

Markdown table syntax (`| --- |`) is **not** parsed — use HTML `<table>`.

## Troubleshooting

**`bun: command not found` in the MCP log.**
Install Bun and make sure it's on your `PATH` (re-open the terminal afterwards).

**Browser shows `ERR_CONNECTION_REFUSED`.**
The server hasn't started yet (Claude does `bun install` on first launch — can
take 10–20 s). Refresh.

**Mic button gives "TTS failed" or transcription error.**
`OPENAI_API_KEY` is missing or invalid. Check the `.env` in the plugin dir.

**Port 8787 busy.**
The server auto-kills stale Claude/bun instances on that port; if it can't,
set `LIVE_WEB_CHAT_PORT` to something else.

**MCP server didn't load.**
You forgot `--dangerously-load-development-channels plugin:live-web-chat@refactor-ua`.
The chat only connects with that flag.

## Limitations & privacy

- **Localhost only** (`127.0.0.1`) — do not expose `8787` to the internet, the
  endpoint has no auth.
- Single browser tab, single user.
- No persisted history — a reload starts fresh.
- Inbox/outbox files persist on disk under `~/.claude/channels/live-web-chat/`.
- If you set `OPENAI_API_KEY`, voice data goes to OpenAI's Whisper/TTS APIs.

This is a developer tool, not a messaging bridge.

## License

Apache 2.0 (preserved from upstream). See [`LICENSE`](LICENSE).
