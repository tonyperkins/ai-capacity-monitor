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

## Reason codes

A failed source reports one of: `timeout`, `cli-not-found`, `spawn-failed`,
`exit-N`, `cli-exited`, `rpc-error`, `bad-output`, `not-signed-in`,
`unreachable`, `http-N`. For `not-signed-in`, run that vendor's CLI once
by hand so it renews its login; the collector never does this itself.

The service needs the CLIs on its `PATH`. They are installed with mise, so the
unit adds `~/.local/share/mise/command-wrappers/bin` and the Antigravity
install folder. `journalctl --user -u capacity-collector.service` shows each pass.

## Output

The service writes and serves the `snapshot.v1` shape in `packages/contract`,
so the existing display firmware reads it unchanged. Each metric also carries
optional `providerId`, `group` and `parent` fields.

- `GET /snapshot/v1` with `Authorization: Bearer <display token>`. Adding the
  header `X-Capacity-Refresh: 1` also starts a new reading (at most one extra
  pass every 30 seconds); the reply is still the current snapshot, and the
  new one is ready a few seconds later.
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
{ "collector": { "intervalMinutes": 10, "sources": { "devin": false }, "hide": ["Claude and GPT models"] } }
```

`hide` leaves limits out of the snapshot. An entry matches a limit's key
(`gemini/gemini-4-argon-weekly-limit`), its group or its label, ignoring case.
Remove the entry to bring the limit back.

`capacity-collector.service` is a systemd user unit, installed in
`~/.config/systemd/user/` and enabled since 2026-11-15. It serves the same
port as the local bridge, so the bridge (`ai-capacity-collector.service`,
despite its name) is stopped and disabled. Rollback steps and the history of
what was tried are in [docs/STATUS.md](../../docs/STATUS.md).
