# Productization plan

## Purpose and recommendation

AI Capacity Monitor is a promising extension-first product: it reads values the
user can already see in authenticated provider pages, gives them a useful local
view, and *optionally* emits a small normalized snapshot to another system.
That should remain the product boundary. A hosted dashboard is a consumer of
the data, not a required part of the product.

The recommended first public shape is:

1. A Chrome Web Store extension that works completely locally.
2. Optional outbound HTTP delivery using one documented event contract.
3. An optional, separately installed local bridge for people who want their
   credentials and integrations outside the browser extension.
4. Provider support delivered as tested extension releases; a narrowly scoped,
   signed remote *data profile* can provide emergency selector adjustments, but
   it must not become a remotely programmable scraper.

This document is intentionally a rework plan, not a claim that the current
prototype is ready to publish.

## Current-state assessment

The existing implementation has the right product split, but its boundaries
are still prototype boundaries.

| Area | What exists now | Product gap |
| --- | --- | --- |
| Local product | Popup, scheduled refresh, provider tabs, last verified reading, recovery for Kilo | Provider state, onboarding, accessibility, and diagnostics are not yet generalized. |
| Provider adapters | Parsing logic and URLs live in `apps/extension/background.js` | Every label, URL, selector heuristic, expected reset window, and Kilo special case is hard-coded together. |
| Publishing | Local snapshot is saved before best-effort delivery | The extension posts a prototype body to one hard-coded `127.0.0.1:8787` receiver; it does not currently emit the documented `snapshot.v1.json` shape. |
| Bridge | A localhost Node process forwards to one Sites ingestion endpoint | Its configuration, headers, acknowledgement handling, retries, and destination are Sites-specific. |
| Dashboard | Useful optional private UI and history | It is not a generic reference consumer yet. |
| Operations | A user systemd unit is available | There is no installer, update process, support bundle, release pipeline, or published security/privacy material. |

The contract mismatch is a priority-zero correctness issue: the schema requires
`version`, `issues`, `unit`, and `status`, whereas the extension currently
sends only `collectedAt` and raw parsed metrics. Before another consumer is
built, collection must create one canonical snapshot and both local storage and
every publisher must use it unchanged.

## Product decisions to lock first

These choices prevent the project from becoming an unbounded browser scraper.

- **Browser scope:** Chrome/Chromium first. Firefox or other browsers are later
  ports, not an assumed compatibility promise.
- **Provider scope:** Ship the currently supported providers as an explicit
  matrix with the exact account pages and metric types supported. New providers
  (for example Gemini and xAI) are adapter projects with acceptance tests, not
  merely entries in Settings.
- **Data boundary:** Read the minimum displayed values required for configured
  metrics. Do not transmit raw DOM, URLs beyond the provider identifier,
  cookies, account names, prompts, conversations, or page screenshots.
- **Local-first default:** Collection and the popup work with no network other
  than the provider page itself. Publishing is opt-in and a failed publisher
  never changes a valid local reading.
- **Freshness truthfulness:** A metric carries `collectedAt`, provider page
  status, validation status, and a reason when its prior value was retained.
  Never turn an unavailable reading into `$0.00` or `0%`.
- **No covert automation:** Opening/reloading tabs is an explicit, visible
  feature controlled by the user. The product must describe that provider pages
  may be loaded/reloaded and must provide a manual-only mode.

## Rework the extension around provider adapters

### 1. Separate the collection core

Replace the large `background.js` collection/parser module with small,
testable modules:

```text
src/
  collection/       scheduler, tab lifecycle, retries, validation, snapshot assembly
  providers/        one adapter directory per provider
  publishing/       local store, HTTP publisher, bridge publisher
  settings/         schema, defaults, migrations, options UI
  ui/               popup and full-page status view
  contract/         generated types and snapshot validation
```

Each provider adapter should declare:

- stable provider and metric IDs;
- allowed page URLs and a user-facing deep link;
- a page-readiness predicate;
- parser functions operating on narrowly scoped page text/elements;
- validation rules (currency format/range, percentage range, monotonic or
  suspicious-value rules);
- whether a reload is required and the safe wait/retry policy;
- metric metadata: label, unit, reset semantics, and documentation link.

The collector should only know how to open/focus/reload a page, request an
adapter reading, validate it, and assemble a snapshot. It must not know that
Kilo has a special zero case or that Claude has Fable.

### 2. Make user choices settings, not source edits

Settings need a typed, versioned model with migration support. The initial
public settings should include:

- enabled providers and enabled metrics;
- automatic collection on/off, interval, and manual-only mode;
- reload policy: never, only pages the extension opened, or all configured
  provider pages (with clear explanation of freshness versus disruption);
- close extension-opened tabs after collection;
- per-provider allow-open-in-background and timeout/retry limits;
- preferred currency/locale/time zone and compact/full popup display;
- one or more publishing destinations, disabled by default;
- data-retention choice for local history and an export/delete-local-data
  control;
- diagnostics consent, disabled by default.

Do **not** expose arbitrary CSS selectors, JavaScript, or page scripts in the
ordinary settings UI. Advanced custom adapters can be a developer feature
outside the Web Store build, but they should not be confused with supported
providers.

### 3. Use least-privilege site permissions

The current manifest declares all current provider hosts at install time and a
specific localhost receiver. Move provider sites to optional host permissions
requested when a user enables a provider. Request a destination host permission
only when the user saves a direct HTTPS webhook. Explain each request in the
onboarding flow. This improves trust and is more sustainable as providers are
added.

## Externalized scraper profiles and update strategy

### What we should do

Use a **hybrid, signed profile system**.

1. Every release bundles the supported adapter code and a reviewed provider
   profile set. That is the normal and safest update channel.
2. A profile may contain only declarative, bounded data: provider/profile
   version, known page route, approved selector alternatives, label aliases,
   bounded text windows, metric enablement, and validation thresholds.
3. The extension ships a fixed parser engine that understands that constrained
   data. It has no `eval`, no downloaded JavaScript/WASM, no arbitrary command
   language, and no ability for a profile to access a new origin.
4. Profiles are signed offline using an Ed25519 release key. The public key is
   packaged in the extension. The extension verifies the signature, validates
   the profile schema, records the profile version, and can roll back to the
   last known-good profile.
5. Remote profile checks are infrequent, user-visible in Diagnostics, cached,
   and do not block collection. A user can disable them, inspect the version,
   and force a rollback.

This permits narrowly scoped emergency changes such as a renamed label or an
additional selector. It does **not** permit shipping a new scraping algorithm
without an extension release. That distinction protects users and keeps the
extension reviewable.

### What we should not do

Do not build an agent that watches arbitrary logged-in user pages, infers a DOM
change, writes new extraction code, and pushes it to every installation. It
would create a serious correctness and supply-chain risk: a false update could
silently report the wrong financial balance, and an attacker who obtained the
update credential could alter page-reading behavior. It would also be hard to
reconcile with Manifest V3's restriction against remotely hosted code and
against remote data that acts as a complex command interpreter.

### A practical maintenance pipeline

Use automation for detection and proposal, not autonomous publication:

```text
sanitized fixtures + provider test accounts
          -> scheduled browser compatibility checks
          -> failure/DOM-signature alert with redacted evidence
          -> bot opens a PR proposing profile changes
          -> maintainer review + regression suite
          -> signed profile release or extension release
          -> staged rollout + rollback monitoring
```

Implementation details:

- Maintain a provider test account only where the provider permits it. Store no
  real user page captures in the public repository.
- Keep sanitized HTML/text fixtures and expected normalized snapshots. Test
  happy paths, loading/empty states, negative credits, reset countdowns, and
  ambiguous amounts such as Kilo's monthly usage versus remaining credits.
- A scheduled CI job can detect that a required label/selector no longer
  matches, compare a coarse structural fingerprint, and open an issue or pull
  request. It must redact values, account names, and identifiers.
- Require a human reviewer for every profile or parser change. High-confidence
  changes may be automatically *proposed*, never auto-merged or auto-published.
- Publish a compatibility status page: provider, adapter/profile version,
  last verification, known issue, and rollback status.

Chrome's current Manifest V3 guidance permits remote configuration where the
logic remains in the packaged extension, but prohibits remote code and warns
against a complex interpreter. See the [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
and [remote hosted code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).

## Make publishing genuinely generic

### Canonical event and snapshot

Keep `packages/contract/snapshot.v1.json` as the payload schema, complete it,
and generate TypeScript types plus runtime validation from it. Define immutable
IDs and units precisely (for example, credit values are USD decimal amounts or
integer minor units—choose one, document it, and never mix them). A canonical
snapshot should include:

- `version`, `snapshotId`, `collectedAt`, and extension/profile versions;
- per-metric `key`, provider, label, kind, numeric value, unit, verification
  status, source freshness, and optional normalized `resetAt`;
- structured diagnostics with a stable code, severity, provider/metric key, and
  safe human message;
- no source page content or identifiers.

For outbound delivery, use HTTPS `POST` with a CloudEvents 1.0 binary HTTP
envelope and put the canonical snapshot in the JSON body. CloudEvents is a
widely used interoperability envelope; it lets a receiver route events without
forcing a dashboard, database, or queue choice. Specify at least:

```text
Content-Type: application/json
ce-specversion: 1.0
ce-type: io.ai-capacity-monitor.snapshot.v1
ce-source: chrome-extension://<installation-id-not-account-id>
ce-id: <uuid>
ce-time: <RFC 3339 timestamp>
Idempotency-Key: <same UUID>
```

The receiver contract is: reply `2xx` only after safely accepting the event;
`429`/`5xx` are retryable; other `4xx` errors are surfaced to the user and not
retried indefinitely. Use bounded exponential backoff with jitter, an outbound
queue cap, and an explicit "delivery delayed" state. Never retry by reloading
provider pages.

CloudEvents' [HTTP binding](https://cloudevents.io/) is the envelope standard;
it does not prescribe authentication. Authentication should therefore be a
transport option rather than a Sites assumption:

| Destination mode | Intended use | Authentication |
| --- | --- | --- |
| Local bridge | Recommended for a dashboard or service with valuable credentials | Extension sends to loopback; bridge owns the remote credential. |
| Direct webhook | Personal services that accept HTTPS requests | User-configured bearer token or per-endpoint static header stored in local extension storage. |
| Signed webhook | Receivers that support verification | HMAC-SHA-256 body signature, timestamp, and key ID; receiver rejects stale/replayed deliveries. |
| Custom connector | Future first-party connectors (Home Assistant, Grafana, etc.) | Packaged connector code and its documented credential flow. |

Use HTTPS for any non-loopback destination. Do not silently transmit a token to
an `http://` remote endpoint. A later enterprise tier can consider RFC 9421 HTTP
Message Signatures, but HMAC with replay protection is a more implementable
first release for a user-configured webhook. RFC 9421 is the standardized
message-signature specification: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html).

### Rework the bridge and dashboard

The bridge becomes a generic reference consumer:

- validate the full canonical snapshot before accepting it;
- authenticate requests from the local extension with a per-install loopback
  secret (not an open unauthenticated port);
- provide destination adapters: generic webhook first, then the current Sites
  adapter as an optional plugin/configuration;
- persist/queue safely enough to survive a transient destination outage;
- expose `/health`, a redacted status endpoint, and a local command to test a
  destination without collecting provider pages;
- ship installers for supported OSes or clearly label the bridge as an advanced
  optional component.

The dashboard should consume the exact same webhook/event contract. It must not
depend on a special payload only the extension knows how to produce. That makes
it a useful reference implementation and allows users to replace it with their
own service.

## Reliability, safety, and user trust work

### Collection correctness

- Make provider read states explicit: `loading`, `read`, `validated`,
  `suspicious`, `retained-prior`, `unauthenticated`, `unsupported-page`, and
  `failed`.
- Preserve the last verified value with its original timestamp. Do not make it
  appear newly collected when only another metric succeeded.
- Replace the generic 10 x 1.5 second retry loop with adapter-specific
  readiness/settling policies and a global collection deadline.
- Add per-provider serialization, cancellation, and tab ownership records so
  automatic, manual, and per-card refreshes cannot race.
- Include a diagnostic page with the selected route/profile, last parser
  decision, and redacted error code—not raw page text.
- Treat provider layout changes, rate limits, bot challenges, and expired login
  as normal states with clear recovery guidance.

### Security and privacy

- Write a public privacy policy before distribution. Page content, browsing
  activity, and financial/payment information are user data even if handled
  locally; Chrome requires accurate disclosure. See Chrome's
  [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
- Add a prominent opt-in disclosure for every publisher, including destination
  hostname, fields sent, retention responsibility, and how to revoke it.
- Store secrets in `chrome.storage.local`, never sync; redact them from logs,
  exports, support bundles, and UI.
- Add schema validation and payload-size limits at every boundary. Treat all
  provider-page text as untrusted input.
- Add a responsible disclosure policy, dependency update process, threat model,
  and release-signing/key-rotation procedure.
- Review each provider's terms and published APIs. Where an official
  balance/usage API is available and allowed, prefer it over page parsing only
  when the user can provide a scoped credential and the privacy tradeoff is
  clear.

### Product readiness and support

- Build first-run onboarding that enables providers one at a time, opens the
  relevant page, confirms the exact metric found, and explains permissions.
- Add an accessible full-page view as the durable alternative to an oversized
  toolbar popup; keep the popup compact.
- Provide local history/export with a clear retention cap. History must remain
  optional and deletable.
- Add locale/currency formatting, keyboard navigation, screen-reader labels,
  high-contrast checks, and narrow-window testing.
- Publish a support matrix, known limitations, changelog, and user-facing
  troubleshooting guide.
- Decide project governance before publicity: license, contribution guide,
  code of conduct, security contact, issue templates, release ownership, and
  whether provider profiles are in the main repository or a signed release
  repository.

## Engineering and release foundation

Before public beta, add a root workspace and repeatable commands for:

- extension type-check/lint, schema validation, unit tests, and deterministic
  ZIP packaging;
- parser fixtures and adapter contract tests without a live authenticated
  browser;
- a small set of permitted end-to-end compatibility checks;
- bridge integration tests using a mock webhook and failure/retry cases;
- dashboard contract-consumer tests;
- dependency/security scanning, provenance, signed Git tags, and release notes.

Version separately but compatibly: extension, snapshot schema, provider profile
bundle, bridge, and dashboard. The extension must reject incompatible profiles
and publishers with a comprehensible error, not silently downgrade data.

Chrome Web Store distribution also requires a production listing package:
icons, screenshots, a clear single-purpose description, privacy disclosures,
permission justifications, a support URL, and a release/update process. Chrome
periodically updates Web Store-installed extensions, so ordinary parser-code
updates can be shipped through reviewed extension releases; remote profiles are
for constrained, reversible compatibility changes, not a replacement for that
release path. See Chrome's [distribution guide](https://developer.chrome.com/docs/extensions/how-to/distribute).

## Suggested delivery sequence

### Phase 0 — establish the contract and trust boundary

1. Define `snapshot.v1` precisely and make the extension, bridge, and dashboard
   use it end-to-end.
2. Extract provider adapters and add fixture/unit coverage for every current
   metric.
3. Add structured collection states and a diagnostic screen.
4. Replace fixed publishing endpoint and Sites-only bridge behavior with the
   generic local bridge + direct HTTPS webhook modes.

**Exit gate:** a user can install the extension, collect locally, configure a
generic mock webhook, and see validated events delivered without Sites.

### Phase 1 — safe private beta

1. Add optional permissions and provider-by-provider onboarding.
2. Ship privacy policy, support matrix, data deletion/export, and error
   reporting consent.
3. Add build/release automation, tests, signed releases, and a packaged
   extension installer/Web Store draft.
4. Pilot with a small group across supported provider/account variants.

**Exit gate:** failures are understandable, no reading is silently corrupted,
and beta users can self-diagnose/disable publishing without support access to
their accounts.

### Phase 2 — provider-profile operations

1. Add signed, constrained profile bundles and rollback.
2. Build sanitized fixtures and scheduled compatibility checks.
3. Add an alert-to-PR maintenance workflow with mandatory human review.
4. Publish provider compatibility status and profile release notes.

**Exit gate:** a label/selector change can be detected, tested, reviewed, and
rolled back without editing a user's machine or shipping remote code.

### Phase 3 — broaden deliberately

Add xAI, Gemini, and other providers one at a time using the adapter acceptance
template. Add reference consumers only after the generic webhook contract is
stable. A dashboard, Home Assistant integration, or hosted history product is
then an independently versioned consumer—not a reason to enlarge extension
permissions or data collection.

## Definition of product-ready v1

Do not call the product public-ready until all of the following are true:

- Every supported metric has an adapter, fixture tests, clear UI status, and a
  documented source page.
- The normalized snapshot schema is implemented and validated at both producer
  and consumer boundaries.
- No endpoint, token, Sites header, provider URL, or parser behavior requires a
  source edit for a normal user configuration.
- Publishing is opt-in, generic HTTPS/loopback based, retry-safe, and never
  required for local use.
- Parser updates are reviewed, tested, reversible, and cannot execute remote
  code.
- The Chrome Web Store permission/privacy/disclosure requirements are met.
- Installation, upgrades, uninstallation, data deletion, and recovery from a
  failed provider page are documented and tested.

At that point, the dashboard remains a compelling optional experience, while
the extension is a credible standalone product rather than a personal setup
with a dashboard attached.
