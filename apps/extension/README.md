# Extension

The extension is independently useful: it collects provider readings, keeps the last verified snapshot in `chrome.storage.local`, and presents it in the toolbar popup.

Each collection refreshes the provider pages before reading the displayed values. The popup also includes an optional **Close provider tabs opened by Capacity Monitor after collection** setting. It affects only tabs the extension created; tabs you already had open are never closed.

## Publisher configuration

Publisher configuration belongs in extension local storage and is disabled by default for a new installation. A publisher is best-effort: collection and the popup must still work when it is unavailable.

```json
{
  "type": "http",
  "endpoint": "http://127.0.0.1:8787/collect",
  "headers": { "Authorization": "Bearer configured-by-user" }
}
```

The payload must conform to `../../packages/contract/snapshot.v1.json`. Localhost is the recommended mode because remote credentials remain outside the extension.
