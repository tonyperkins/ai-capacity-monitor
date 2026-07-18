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

## Value conventions (v1)

- `kind: "credit"` with `unit: "usd"`: integer minor units (cents).
  `305` means $3.05. Never decimal dollars.
- `kind: "credit"` for non-currency pools (e.g. Google One AI credits):
  integer count of credits.
- `kind: "quota"` with `unit: "percent"`: integer 0–100, always
  **percent remaining** regardless of how the source page phrases it.
