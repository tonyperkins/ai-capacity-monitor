# Local bridge

The optional local bridge is a generic, loopback-only consumer of the
versioned snapshot contract. It is useful when a dashboard or webhook needs a
credential that should not live in the browser extension.

The bridge listens only on `127.0.0.1:8787` and accepts `POST /collect` with
the extension's `x-collector-secret`. It validates every payload before it is
queued or forwarded; raw page text, cookies, and extension secrets are never
logged or included in health output.

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
  "queue": { "maxItems": 50 }
}
```

Destinations are generic webhooks. HTTPS is required except for loopback test
endpoints. A Sites destination is simply a webhook URL plus any required
headers; the old `siteUrl`, `token`, and `sitesBypassToken` configuration is
migrated once to that generic shape for existing installations.

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

## Persistent user service

Install the included `ai-capacity-collector.service` as a user service and keep
the credential-bearing configuration outside this repository.
