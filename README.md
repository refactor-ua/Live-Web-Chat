# Live Web Chat

Localhost browser chat plugin for Claude Code with voice (Whisper STT, OpenAI TTS),
structured permission previews, file uploads, and inline HTML rendering in
assistant messages. Single tab, single user, no auth.

Forked from [`anthropics/claude-plugins-official#external_plugins/fakechat`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat)
at commit `7994c270` and maintained independently — adds the voice pipeline,
custom UI, and several rendering / permission improvements.

## Install

Run inside a `claude` session:

```
/plugin marketplace add refactor-ua/Live-Web-Chat
/plugin install live-web-chat@live-web-chat
```

Then relaunch with the channel flag — the MCP server only connects when this is set:

```sh
claude --channels plugin:live-web-chat@live-web-chat
```

On startup the server prints its URL to stderr:

```
live-web-chat: http://localhost:8787
```

Open it. Type. The assistant replies in-thread.

## Configuration

Set `LIVE_WEB_CHAT_PORT` to change the port (default `8787`).

Voice features require `OPENAI_API_KEY` — put it in a `.env` file next to
`server.ts` (see `.env.example`).

Runtime config lives in `~/.claude/channels/live-web-chat/config.json` (created
on first run). The UI exposes mode (PTT / Confirmation / On-Completion /
Always), TTS voice and speed, language, etc.

## Tools

| Tool | Purpose |
| --- | --- |
| `reply` | Send a message to the UI. Takes `text`, optionally `reply_to` (message ID) and `files` (absolute paths, ≤50MB each). |
| `speak` | Send a TTS audio reply (OpenAI TTS). |
| `edit_message` | Edit a previously-sent message in place. |

Inbound images/files save to `~/.claude/channels/live-web-chat/inbox/` and the
path is included in the notification. Outbound files are copied to `outbox/`
and served over HTTP.

## Rendering

Assistant messages render inline HTML for: `<table>` / `<thead>` / `<tbody>` /
`<tr>` / `<th>` / `<td>` (with colspan/rowspan), `<ul>` / `<ol>` / `<li>`,
`<code>`, `<pre>`, `<b>` / `<strong>`, `<i>` / `<em>`, `<br>`, `<hr>`, `<p>`.

Markdown table syntax is **not** parsed — use HTML `<table>` for tables.

## Not a real channel

No history, no search, no access control, no skill. Single browser tab, fresh
on every reload. This is a dev tool, not a messaging bridge.

## License

Apache 2.0 (preserved from upstream). See `LICENSE`.
