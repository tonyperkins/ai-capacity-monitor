# AI Capacity Monitor

A standalone Chrome extension that reads user-visible AI credit balances and subscription limits from authenticated provider tabs. It remains useful locally through its toolbar popup and can optionally publish a normalized snapshot to a user-chosen service.

## Project layout

- `apps/extension` — Manifest V3 extension, provider readers, popup, local snapshot.
- `apps/local-bridge` — optional local HTTP receiver for forwarding snapshots.
- `apps/dashboard` — optional private Sites dashboard and durable history.
- `packages/contract` — versioned publish contract and provider metric registry.
- `docs` — architecture and service-author guidance.

## Security model

The extension never publishes raw page text, browser cookies, API tokens, or account identifiers. Provider site access is opt-in: a fresh install requests no provider access, and Settings requests each provider's exact origin only after the user enables it. Publishing is also opt-in and disabled by default: readings stay on the device until the user configures a destination in Settings — either the local bridge (loopback only, authenticated with a per-install secret) or a direct HTTPS webhook (HTTPS required except toward loopback; optional Authorization header). Every destination receives the same versioned `snapshot.v1.json`-conformant payload; failed deliveries queue with bounded exponential-backoff retry and never affect local readings. Provider collection itself is also opt-in per provider.

See the [privacy policy](docs/privacy-policy.md) for the exact local-storage,
publishing, and deletion behavior. Draft Chrome Web Store permission
justifications live in [docs/web-store-permissions.md](docs/web-store-permissions.md).

## Development

- **Test:** `cd apps/extension && npm test` (plain `node --test tests/`, no dependencies).
- **Package:** `python3 scripts/package-extension.py` writes a deterministic Web Store ZIP to `dist/`; the same commit always produces a byte-identical archive.
- **CI:** GitHub Actions runs the test suite, syntax checks, contract validation, and a packaging determinism check on every push and pull request to `main`.
- **Release:** bump `version` in `apps/extension/manifest.json`, move the `Unreleased` notes to a new heading in `CHANGELOG.md`, commit, then tag and push `vX.Y.Z` (must match the manifest version). The Release workflow re-runs the tests, packages the extension, and publishes a GitHub release with the ZIP attached.
- **Contract:** `snapshot.v1.json` is additive-only; breaking changes require a `snapshot.v2.json`. See [packages/contract/README.md](packages/contract/README.md).

## Product roadmap

The current project is a working personal prototype. The proposed path to a
shareable, extension-first product—including provider profile updates, generic
webhook publishing, security, testing, and release operations—is documented in
[docs/productization-plan.md](docs/productization-plan.md).
