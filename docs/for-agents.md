# Reading quota capacity (for agents and scripts)

The collector service (`capacity-collector.service`) writes the current
subscription quota for Claude, ChatGPT, Gemini (Antigravity), Grok and Devin to

```
~/.config/ai-capacity-monitor/latest-snapshot.json
```

every 10 minutes. Read that file. Don't run the vendor CLIs yourself, and don't
edit or delete anything in that directory.

## Quick look

```sh
jq -r '"collected \(.collectedAt)",
  (.metrics[] | [.providerId, .label, .display, .readState, (.resetText // "-")] | @tsv)' \
  ~/.config/ai-capacity-monitor/latest-snapshot.json
```

Example output (2026-11-17):

```
collected 2026-11-17T16:33:08.584Z
claude   Current session                  90%  validated  Resets Tue, Nov 17, 12:30 PM
claude   Current week (all models)        82%  validated  Resets Sat, Nov 21, 10:00 AM
chatgpt  5-hour limit                     100% validated  Resets Tue, Nov 17, 11:47 AM
chatgpt  Weekly limit                     66%  validated  Resets Thu, Nov 19, 7:52 AM
gemini   Gemini Models · Five Hour Limit  97%  validated  Resets Tue, Nov 17, 12:53 PM
grok     Weekly limit                     39%  validated  Resets Wed, Nov 18, 8:28 PM
devin    Daily quota                      100% validated  Resets Wed, Nov 18, 2:00 AM
```

## How to read it

- **Percent is capacity remaining**, not used. 100% means untouched.
- **Check freshness first.** `collectedAt` older than about 15 minutes means
  the collector is stopped or stuck (`systemctl --user status
  capacity-collector`); treat the numbers as stale.
- **Trust only `readState: "validated"`.** Anything else (with an `errorCode`,
  for example `not-signed-in`) means that reading failed; the value shown may
  be an older retained one. `issues` lists problems; `sources` gives each
  provider's state.
- **Limits come and go.** Match on `providerId` plus label text, not a fixed
  list. For example, Claude adds "Current week (Fable)" only while that limit
  exists, and Gemini has a separate "Gemini 4 Argon" weekly group.
- **Short and long windows:** `resetWindowMs` is the window length (5 hours,
  1 day, 7 days). The short window says whether you can work right now; the
  weekly one says how much is left until `resetAt`.
- Grok reports only a weekly limit; Devin reports daily and weekly.

## Suggested rule for choosing a subscription

Prefer the provider with the most remaining in its tightest window. Stop
starting new work on a provider under about 10% remaining in any window, and
say which one is low.

## Over HTTP

The same snapshot is served at `GET http://<collector-host>:8788/snapshot/v1`
with the display bearer token (from `~/.config/ai-capacity-monitor/collector.json`).
Local agents should use the file instead, so they don't need the token. Sending
the header `X-Capacity-Refresh: 1` asks for a new read of every provider. Don't
send it routinely: it's limited to one read per 55 seconds and exists for the
display's pull-to-refresh.

The field contract is `snapshot.v1`; see `packages/contract/README.md`.
