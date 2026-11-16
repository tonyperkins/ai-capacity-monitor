# Architecture

## Current: local collector

Since 2026-11-15 the display is fed by `apps/collector`, not by the extension
and bridge described in the rest of this page. See [STATUS.md](STATUS.md).

- **Sources** (`apps/collector/sources/*.js`), one per subscription. Each
  exports `id`, `name`, `read()` and a pure `parse()`. `read()` runs the
  vendor's CLI (or, for Devin, one HTTPS request) and returns a list of limits:
  `{ id, label, remaining, resetAt?, windowMs?, group?, parent? }`. The list is
  whatever the provider reports; no source names the lines it expects.
- **`collect.js`** runs every enabled source and builds a `snapshot.v1`
  payload. A source that answers replaces its lines outright, so a limit that
  went away disappears. A source that fails keeps its previous lines, marked
  `retained-prior`, and adds an issue with a short reason code.
- **`run.js`** collects on a timer (10 minutes by default), writes
  `latest-snapshot.json`, and serves `GET /snapshot/v1` to the display with
  the bearer token the bridge used.
- **Credentials**: the collector holds none. Each CLI keeps its own login
  fresh. The one exception is Devin, whose API key is read from Devin's own
  credentials file at request time and never stored or logged.
- **Display** (`apps/square-dashboard`): groups readings by `providerId` and
  summarises each provider by rule (tightest long-window limit, tightest
  short-window limit), so new or missing lines need no firmware change. A
  reading it does not understand is skipped and reported as an issue.

To add a subscription, add one file under `sources/` and list it in
`SOURCES` in `collect.js`.

## Earlier: extension and bridge

The extension is the primary product and source of local truth. Provider adapters run in authenticated tabs, emit validated metric readings, and preserve the last verified reading when a page is unsettled or a reading is suspect. Adapters normally parse rendered page content; a narrowly scoped authenticated-response reader may supply the same card value when Chrome indefinitely throttles hidden-page rendering. Such readers validate a fixed response shape and emit only the normalized metric, never raw response data or account identifiers.

The popup reads the local snapshot. Publishing is best-effort and must never block or degrade local use.

## Publishing contract

Consumers receive the `snapshot.v1.json` shape. The payload excludes raw DOM content, session data, cookies, API keys, and user identifiers. A consumer can be a localhost bridge, a hosted history service, a notification service, or a dashboard.

## Recommended publisher modes

1. Disabled (default): extension popup and local snapshot only.
2. Local HTTP receiver: `127.0.0.1` service owns remote credentials, validates the contract, retains a bounded on-disk delivery queue, and forwards to a generic webhook.
3. Direct webhook: explicit user-configured HTTPS URL and authorization header.

## Local bridge behavior

The local bridge is a reference consumer, not a dashboard-specific shim. It
requires a per-install secret on `POST /collect`, validates every
`snapshot.v1.json` payload before queuing it, and forwards it through a
configurable generic webhook destination. A failed destination leaves the
snapshot in a bounded local queue and retries with backoff. `GET /health`
reports only redacted operational status and never exposes a secret, token,
metric value, or source-page content.

## Collection cadence

The default automatic-collection interval is 20 minutes. Credit balances and
quota windows don't move fast enough to justify tighter polling, and a
shorter interval reloads the extension-owned pinned collection tabs often
enough to look like automated traffic to a provider's bot detection. The
collector never reads or reloads provider tabs the user opened. An optional,
default-off minimized collection window can isolate those tabs from the main
Chrome window; collection never requests focus for it. A permanently active
local anchor gives the window a stable title. The anchor is loaded in an
inactive tab before its native window is created, so compositor rules can
match the initial title. On Omarchy/Hyprland a silent special-workspace rule
provides desktop isolation when native minimization is ignored (see
[Omarchy setup](omarchy.md)). Users who want fresher
data can lower the interval in Settings or use the manual/per-card refresh,
which are unaffected by this default.
