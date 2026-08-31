# Capacity Monitor privacy policy

Effective: July 18, 2026

Capacity Monitor is a browser extension that displays AI-service credit balances
and plan-limit readings that you choose to monitor. This policy describes what
the extension handles and how you control it.

## What the extension reads

When you enable a provider, Capacity Monitor receives permission for that
provider's site and reads the displayed credit-balance and usage-limit values
needed to show its popup. It may inspect the provider page to determine whether
you are signed in and may open or reload that provider's page while collecting.
When a minimized browser window prevents a displayed card from rendering, a
provider adapter may validate the authenticated response that supplies that
specific card and retain only the normalized reading.
It does not ask for, display, or store your passwords, cookies, authentication
tokens, account identifiers, or raw provider-page text.

## What is stored locally

Capacity Monitor stores the latest derived readings, their timestamps, safe
diagnostic states, selected providers, collection preferences, and a bounded
delivery queue in `chrome.storage.local` for the Chrome browser profile where
you installed it. This data is not stored in Chrome sync by Capacity Monitor.
It remains there until a newer reading replaces it, you disable a provider, or
you delete it.

If you configure publishing, the selected destination URL and any bridge secret
or webhook Authorization header are also stored in that same local extension
storage. Saved secrets are not displayed again in the extension UI and are
never included in diagnostics, logs, or snapshot payloads.

## When data leaves this device

By default, nothing is sent off-device. Publishing is optional and requires a
separate acknowledgement in Settings for the exact destination before it can
be activated.

When you enable publishing, the user-selected destination receives a normalized
snapshot containing provider and metric names, numeric derived values, units,
timestamps, reset information, and safe diagnostic states. It does not receive
raw provider-page text, browser cookies, account identifiers, or stored
secrets. Direct webhooks require HTTPS; a local bridge may use a loopback HTTP
address on the same computer. The destination is operated by you or a service
you choose, so its handling of the snapshot is your responsibility.

Capacity Monitor has no developer-operated collection server, analytics, or
advertising use of these readings.

## Your controls

You can enable or disable providers and remove their optional site permissions
in Settings. You can turn publishing off at any time. **Delete all local data**
in Settings clears Capacity Monitor's readings, diagnostics, delivery queue,
preferences, configured destinations, and saved secrets from local extension
storage. It does not remove optional Chrome site permissions; use each
provider's **Remove access** control for that.

## Limited use

Capacity Monitor uses the permissions and derived readings only to provide its
displayed capacity-monitoring feature and, when you explicitly configure one,
to deliver a snapshot to your chosen destination. It does not sell, use, or
transfer this data for advertising, profiling, or unrelated purposes.

## Updates and questions

Changes to this policy are made in this repository. Questions or reports can
be opened through the project's GitHub issue tracker.
