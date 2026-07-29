# Local bridge

The optional local bridge is a generic, loopback-only consumer of the
versioned snapshot contract. It is useful when a dashboard or webhook needs a
credential that should not live in the browser extension.

The bridge listens only on `127.0.0.1:8787` and accepts `POST /collect` with
the extension's `x-collector-secret`. It validates every payload before it is
queued or forwarded; raw page text, cookies, and extension secrets are never
logged or included in health output.

An optional, separate read-only server can expose the latest validated
snapshot to trusted LAN displays. Collection ingestion remains loopback-only;
the LAN listener accepts only authenticated `GET /snapshot/v1` requests.

## Configuration

Keep the config outside the repository, for example at
`~/.config/ai-capacity-monitor/collector.json` with mode `0600`:

```json
{
  "collectorSecret": "generated-on-first-start-if-omitted",
  "destination": {
    "type": "webhook",
    "url": "https://example.com/capacity",
    "headers": { "Authorization": "Bearer configured-by-user" }
  },
  "display": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 8788,
    "token": "generated-on-first-start-if-omitted"
  },
  "queue": { "maxItems": 50 }
}
```

Destinations are generic webhooks. HTTPS is required except for loopback test
endpoints. A Sites destination is simply a webhook URL plus any required
headers; the old `siteUrl`, `token`, and `sitesBypassToken` configuration is
migrated once to that generic shape for existing installations.

`destination` is optional when the display endpoint is enabled, so the bridge
can serve a local display without forwarding data anywhere else. The latest
validated snapshot is stored as `latest-snapshot.json` beside the config with
mode `0600` and survives bridge restarts.

The bridge stores a bounded `queue.json` beside the config. It writes a valid
snapshot to disk before attempting delivery and retries failed deliveries with
exponential backoff. If the queue is full or unavailable, it returns `503` so
the extension's own publisher queue retains the snapshot.

## Health and authentication

`curl http://127.0.0.1:8787/health` returns the queue size, last receive time,
and redacted delivery state. It does not reveal tokens, secrets, metric values,
or raw payloads.

The bridge generates a collector secret on first start if one is absent and
prints it once. Paste it into the extension Settings page under **Local bridge
secret**. Requests without the matching secret receive `401`.

Enable the read-only display endpoint without manually editing a file that may
already contain forwarding credentials:

```sh
CAPACITY_COLLECTOR_CONFIG=~/.config/ai-capacity-monitor/collector.json npm run display:enable
systemctl --user restart ai-capacity-collector.service
```

The setup command preserves the rest of the configuration, writes the file
with mode `0600`, and prints only the newly generated display token. Use
`node configure-display.js status` for a redacted status check. The
`show-token` command is available when provisioning another trusted display.

When `display.enabled` is true, the bridge generates a separate display token
if one is absent. The CYD sends it as `Authorization: Bearer <token>`. The LAN
server exposes no write routes, raw page contents, cookies, collector secret,
or forwarding credentials. Keep the selected port restricted to your trusted
LAN; it is plain HTTP because the microcontroller connects directly by local
address.

## Persistent user service

Install the included `ai-capacity-collector.service` as a user service and keep
the credential-bearing configuration outside this repository.
