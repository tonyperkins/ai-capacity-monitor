# Where this project stands

Last updated 2026-11-15. Read this first when coming back to the project.

## What the project is for

Show subscription quota for the AI tools in daily use, at a glance, on a
480×480 desk display. Nothing more.

## What runs today

```
vendor CLIs / Devin API  ->  apps/collector (systemd user service, port 8788)
                              |-- ~/.config/ai-capacity-monitor/latest-snapshot.json
                              `-- GET /snapshot/v1  ->  apps/square-dashboard (ESP32-S3 display)
```

- **Collector** (`apps/collector`, unit `capacity-collector.service`): reads
  Claude, ChatGPT, Gemini (Antigravity), Grok and Devin every 10 minutes. No
  browser, no extension. See its [README](../apps/collector/README.md).
- **Display** (`apps/square-dashboard`): polls the collector once a minute.
  Faces: Home (one row per provider), Limits, Settings.
- **Snapshot file**: other local tools (for example coding agents deciding
  which subscription to use) read `latest-snapshot.json`.

## What changed on 2026-11-15 (branch `local-collector`)

1. The Chrome extension and local bridge were replaced, for the display, by
   the collector. The extension is disabled in Chrome. Its code, the bridge,
   the CYD firmware and the Chrome Web Store documents are still in the
   repository, unchanged and unused.
2. Scope was cut to **subscription quotas only**. Kilo was dropped. Credit
   balances (OpenAI, Claude Platform, xAI, Google One) are deferred to a v2.
3. Limits are **discovered, not declared**. A source reports whatever lines
   the provider shows (for example Claude's "Current week (Fable)", which
   comes and goes). Nothing in the collector or the firmware lists expected
   lines.
4. The firmware became tolerant: a reading it does not understand is skipped
   and counted as an issue, where before it rejected the whole snapshot.
5. The firmware's Overview and Balances tabs were replaced by a Home face:
   one row per provider with a short-window and a weekly column. A first
   attempt (concentric Rings plus a Dispatch ranking) was flashed and
   dropped the same day: the rings looked good but were hard to decode.
6. The collector got a `hide` list. Antigravity's "Claude and GPT models"
   group is hidden, because only the Gemini models are used there.

## Verified, and not

| Item | State |
|---|---|
| Collector reads all five subscriptions under systemd | Verified 2026-11-15 |
| Collector serves `/snapshot/v1` with the display token | Verified with curl |
| Collector unit tests (`node --test` in `apps/collector`) | Pass |
| Firmware UI headless test, with rendered previews reviewed | Pass |
| Firmware compiled by ESPHome 2026.10.2 and flashed to the device | Done 2026-11-15 over `/dev/ttyUSB0`; the device log showed `Snapshot accepted: 13 metrics`. ESPHome is not installed; run it with `uvx --from esphome==2026.10.2 esphome ...`. The user is not in the `uucp` group, so the serial port needs `sudo setfacl -m u:$USER:rw /dev/ttyUSB0` after each replug. |
| Home face on the physical panel | Flashed 2026-11-15 evening; the device log showed `Snapshot accepted: 11 metrics`. Legibility and touch on the panel are for the owner to judge. The log also warns that `fetch_snapshot` blocks for about 650 ms (fetch plus redraw); harmless so far, not investigated. |
| `claude -p "/usage"` uses no quota | Believed, not measured |
| `agy` keeps its Google login fresh when only the service runs it | Unknown; watch for a Gemini `not-signed-in` issue |
| Devin API key lifetime | Unknown |
| Devin numbers match Devin's own usage screen | Not compared |

## Next steps

1. To reflash after a change:
   ```sh
   uvx --from esphome==2026.10.2 esphome compile apps/square-dashboard/capacity.yaml
   uvx --from esphome==2026.10.2 esphome upload apps/square-dashboard/capacity.yaml --device /dev/ttyUSB0
   ```
   `secrets.yaml` needs no change; the collector uses the bridge's port and token.
2. Live with the Home face and adjust sizes or colours as needed.
3. Optional faces, designed but not built: **Pace** (where each week lands
   at the current rate) and **Refill timeline**. The Home face already
   carries the pace idea as the tick on each bar. Mockups:
   https://claude.ai/artifact/1TQN24MW3DiPkig7hBLxzR
4. Once the collector has run without trouble for a while, remove the
   extension, bridge and Chrome Web Store documents in one commit.
5. v2: credit balances. No vendor CLI exposes them, so the likely route is a
   headless browser page read, possibly with a local model extracting values.

## Roll back to the extension and bridge

```sh
systemctl --user disable --now capacity-collector.service
systemctl --user enable --now ai-capacity-collector.service   # the old bridge
```

Then re-enable the extension in Chrome. The last bridge snapshot is saved as
`~/.config/ai-capacity-monitor/latest-snapshot.before-collector.json`. The
previous firmware reads either service.

## Things that were tried and did not work

Kept so they are not tried again.

- **Claude**: `claude -p "/usage" --bare` prints cost only, because `--bare`
  drops subscription sign-in.
- **Gemini**: Google's `retrieveUserQuotaSummary` endpoint returned one quota
  group of three. `agy --print "/quota"` returns all of them.
- **Grok**: `grok usage --json` refuses to run outside an interactive session,
  and the `/v1/billing` web endpoint has no weekly percentage. The
  `_x.ai/billing` request over `grok agent stdio` has it.
- **Devin**: `devin -p "/usage"` is not a command in print mode. The
  plan-status request works, but its version fields must be three dotted
  numbers ("1.0.0"); "1" returns HTTP 500.
