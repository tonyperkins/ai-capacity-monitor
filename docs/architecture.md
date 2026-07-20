# Architecture

The extension is the primary product and source of local truth. Provider adapters run in authenticated tabs, emit validated metric readings, and preserve the last verified reading when a page is unsettled or a reading is suspect.

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
Chrome window; collection never restores or focuses it. Users who want fresher
data can lower the interval in Settings or use the manual/per-card refresh,
which are unaffected by this default.
