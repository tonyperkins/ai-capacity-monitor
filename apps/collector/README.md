# Capacity collector

A small local service that reads subscription quota for Claude, ChatGPT,
Gemini (Antigravity), Grok and Devin, and serves it to the desk display. It
needs no browser and no extension.

## How each subscription is read

| Subscription | How |
|---|---|
| Claude | `claude -p "/usage"` |
| ChatGPT | `codex app-server`, one `account/rateLimits/read` request |
| Gemini | `agy --print "/quota"` |
| Grok | `grok agent stdio`, one `_x.ai/billing` request |
| Devin | Plan-status request with the API key in `~/.local/share/devin/credentials.toml` |

The first four go through the vendor's own CLI, which keeps its own login
fresh. The collector never reads or refreshes their tokens. Each CLI runs from
`~/.cache/ai-capacity-monitor/cwd`, an empty folder.

## Limits are discovered, not declared

A source returns whatever limits the provider reports: label, percent
remaining, reset time and window. Nothing lists the expected lines, so a limit
that appears (a model-specific weekly line, a new quota group) shows up on the
next pass, and one that goes away disappears.

If a source fails, its previous lines stay, marked as prior values, and the
snapshot carries an issue naming the source and a short reason code.

## Output

The service writes and serves the `snapshot.v1` shape in `packages/contract`,
so the existing display firmware reads it unchanged. Each metric also carries
optional `providerId`, `group` and `parent` fields.

- `GET /snapshot/v1` with `Authorization: Bearer <display token>`
- `GET /health` (no values, only per-source state)

## Run

```sh
node run.js --once          # collect once and print the snapshot
node run.js --once --write  # also save it to the snapshot file
node run.js                 # serve the display and collect on a timer
node --test
```

Configuration is the `display` section of
`~/.config/ai-capacity-monitor/collector.json` (host, port, token), the same
one the local bridge uses, so a provisioned display needs no change. Optional:

```json
{ "collector": { "intervalMinutes": 10, "sources": { "devin": false } } }
```

`capacity-collector.service` is a systemd user unit. It serves the same port
as the local bridge, so stop `ai-capacity-collector.service` (the bridge)
before starting it.
