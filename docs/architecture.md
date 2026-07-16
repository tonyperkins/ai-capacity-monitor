# Architecture

The extension is the primary product and source of local truth. Provider adapters run in authenticated tabs, emit validated metric readings, and preserve the last verified reading when a page is unsettled or a reading is suspect.

The popup reads the local snapshot. Publishing is best-effort and must never block or degrade local use.

## Publishing contract

Consumers receive the `snapshot.v1.json` shape. The payload excludes raw DOM content, session data, cookies, API keys, and user identifiers. A consumer can be a localhost bridge, a hosted history service, a notification service, or a dashboard.

## Recommended publisher modes

1. Disabled (default): extension popup and local snapshot only.
2. Local HTTP receiver: `127.0.0.1` service owns remote credentials and forwards the contract.
3. Direct webhook: explicit user-configured HTTPS URL and authorization header.
