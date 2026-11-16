# Snapshot contract

`snapshot.v1.json` is the single canonical payload shape for collected
metrics. The extension assembles it, every publisher transmits it unchanged,
and every consumer (bridge, dashboard, user webhooks) validates against it.

## Versioning policy

- **v1 is additive-only.** New *optional* fields may be added to the snapshot
  or to metric entries. Consumers must ignore fields they don't recognize.
- **Anything else is v2.** Renaming, removing, retyping, or changing the
  meaning of an existing field — including value-unit semantics — requires a
  new `snapshot.v2.json` file alongside this one, a new `version` constant,
  and an extension release that produces it. v1 stays in the repository as
  long as any supported consumer accepts it.
- Producers always set the top-level `version` field; consumers must reject
  payloads whose `version` they do not support with a clear error rather
  than guessing.

## Optional fields added by the collector

All additive; a consumer that does not know them ignores them.

- Metric `providerId`: stable lowercase id of the subscription (`claude`,
  `chatgpt`, `gemini`, `grok`, `devin`). Use it to group a provider's limits.
  `provider` remains the display name.
- Metric `group`: the provider's own grouping of a limit, for example an
  Antigravity quota group.
- Metric `parent`: `key` of the limit this one counts toward. Claude's
  "Current week (Fable)" has the all-models weekly limit as its parent.
- Top-level `sources`: per-source state for the pass, `{ "<id>": "<state>" }`.

Metric keys from the collector are `<providerId>/<limit id>`. They are stable
while the provider's label is, and are not a fixed list: limits appear and
disappear with what the provider reports. Consumers should group by
`providerId` and never depend on a particular key being present.

A consumer should skip a metric it cannot interpret and keep the rest of the
snapshot. The square display does this; the local bridge validator still
rejects the whole payload, and is retired.

## Value conventions (v1)

- `kind: "credit"` with `unit: "usd"`: integer minor units (cents).
  `305` means $3.05. Never decimal dollars.
- `kind: "credit"` for non-currency pools (e.g. Google One AI credits):
  integer count of credits.
- `kind: "quota"` with `unit: "percent"`: integer 0–100, always
  **percent remaining** regardless of how the source page phrases it.

## Collection states and diagnostics

New snapshots include one diagnostic per metric attempted in that collection
pass. A metric with a known value also carries the same detailed `readState`
field. The older `status` field remains `verified`/`unverified` for v1
consumer compatibility.

- `validated` — a fresh reading passed the adapter's checks.
- `suspicious-held` — a surprising replacement is being confirmed; the prior
  verified value remains visible.
- `retained-prior` — the current read failed, so a prior verified value remains
  visible.
- `unauthenticated` — the provider page appears to require sign-in.
- `permission-needed` — the provider was enabled but the user has not granted
  the extension access to that provider's site.
- `failed` — no reading is available and there is no prior verified value.

`errorCode` is a stable, safe machine-readable reason such as
`sign-in-required`, `page-still-loading`, `metric-not-found`, or
`collection-deadline`. It never contains provider page text.
