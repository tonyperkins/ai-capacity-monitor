# Changelog

Notable changes per release. The extension manifest version, the git tag,
and the heading here move together — see the Development section of the
README for the release steps.

## Unreleased

## 0.1.0 — 2026-07-18

Initial tagged release of the working prototype.

- Chrome MV3 extension collecting 10 metrics across 8 provider surfaces
  (Kilo, OpenAI platform, Claude platform, ChatGPT, Claude.ai, x.ai console,
  Gemini app, Google One AI credits): credit balances and quota windows with
  reset countdowns, popup with usage and time-remaining meters.
- Suspicion/hold reconciliation for sudden zero balances; per-metric
  freshness timestamps; direction-aware percent parsing; HTML-escaped
  rendering.
- Publishing of `snapshot.v1.json`-conformant payloads to a local bridge
  authenticated with a per-install secret; Cloudflare Worker dashboard
  validating the same contract.
- Fixture test suite over the shipped parser (14 tests).
