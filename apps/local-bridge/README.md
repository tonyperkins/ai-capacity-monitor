# Local bridge

The local bridge is an optional consumer of the extension snapshot contract. It listens only on `127.0.0.1`, can keep service credentials in a user-local configuration file, and forwards snapshots to a dashboard or any other service.

It is not required for the extension popup or local collection.

## Authentication

The bridge does not accept unauthenticated requests. The first time it starts without a `collectorSecret` in its config, it generates one, writes it back to the config file, and prints it once to the console. Paste that value into the extension's Settings page under "Local bridge secret" — the extension sends it on every collection, and the bridge rejects any `/collect` request that doesn't include it.

## Persistent user service

Install the included `ai-capacity-collector.service` as a user service and keep its credential-bearing configuration at `~/.config/ai-capacity-monitor/collector.json` (mode `0600`). The configuration is deliberately outside this repository.
