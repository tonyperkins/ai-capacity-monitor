# Extension

The extension is independently useful: it collects provider readings, keeps the last verified snapshot in `chrome.storage.local`, and presents it in the toolbar popup.

Each collection refreshes provider pages that were already open before reading the displayed values; newly created tabs are allowed to load normally without an unnecessary second navigation. Kilo is collected from its dedicated Credits page. If a credit balance temporarily reports a suspicious zero, the extension preserves the prior verified value and schedules a narrowly scoped confirmation collection instead of overwriting it. The popup also includes an optional **Close provider tabs opened by Capacity Monitor after collection** setting. It affects only tabs the extension created; tabs you already had open are never closed.

Each adapter declares its own readiness and retry policy. A collection has a
30-second global deadline, so one unavailable provider cannot keep a scheduled
pass running indefinitely. The popup marks a metric as a fresh reading,
confirming change, showing a prior value, sign-in required, or unavailable.
Settings includes a diagnostics section with the last attempt time and safe
error code for each enabled provider; it never stores raw provider-page text.

The four balance cards have individual refresh controls. A card refresh reads and publishes only that provider's balance, without replacing the other locally stored or dashboard readings. The popup's **Automatic updates** toggle pauses or resumes scheduled collection. The extension's Settings page repeats that toggle and lets you set the schedule from 1 to 1,440 minutes; manual collection remains available while automatic updates are paused.

Every balance card and quota row is also a link to its underlying provider page. Clicking an item focuses the existing matching tab or opens the page in the foreground when it is not already open. The refresh icon on a balance card refreshes that provider instead of navigating.

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
