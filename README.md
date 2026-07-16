# AI Capacity Monitor

A standalone Chrome extension that reads user-visible AI credit balances and subscription limits from authenticated provider tabs. It remains useful locally through its toolbar popup and can optionally publish a normalized snapshot to a user-chosen service.

## Project layout

- `apps/extension` — Manifest V3 extension, provider readers, popup, local snapshot.
- `apps/local-bridge` — optional local HTTP receiver for forwarding snapshots.
- `apps/dashboard` — optional private Sites dashboard and durable history.
- `packages/contract` — versioned publish contract and provider metric registry.
- `docs` — architecture and service-author guidance.

## Security model

The extension never publishes raw page text, browser cookies, API tokens, or account identifiers. Publishing is disabled by default. Consumers receive only validated metrics and collection diagnostics defined by the contract.
