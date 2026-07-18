# Troubleshooting

## A card is stale or says “Showing prior value”

Use the card's refresh icon or **Collect now**. Capacity Monitor reloads the
provider page to get a current value. If it stays stale, open Settings and use
Diagnostics: the safe error code and attempt time identify whether the page was
still loading, signed out, or missing its expected value.

## “Permission needed”

Open Settings, find the provider, and select **Grant access**. Chrome will ask
for that provider's exact site. If you removed its permission, re-enable it
there; the scheduler never asks for permissions by itself.

## The provider is signed out

Open the provider item from the popup, sign in on the provider's own page, and
collect again. Capacity Monitor never asks for or displays credentials.

## Publishing says delayed, rejected, or saved locally

The popup always keeps the local reading. For a local bridge, confirm the
bridge is running and its secret matches Settings. For a webhook, confirm the
HTTPS endpoint, its authorization header, and the receiver's response. Review
and acknowledge the publishing disclosure again if the destination changed.

## Start over

In Settings select **Delete all local data** and confirm. It clears local
readings, diagnostics, preferences, destinations, queues, and saved secrets.
Optional site permissions remain until removed from the provider controls.
