# Contributing

## Before changing a provider adapter

Provider pages change often. Keep an adapter change narrow and include a
sanitized fixture test for the exact page pattern it supports. A provider is
ready only when it:

- uses an exact configured page and optional host permission;
- reads only the displayed derived metric required by the popup;
- preserves sign-in and unavailable-page states without retaining page text;
- validates the value/unit and does not overwrite a safe prior reading with a
  suspicious result; and
- documents the page, metric, plan verification, and limitations in the
  support matrix.

Do not commit browser profiles, cookies, balances, screenshots with real
account data, local bridge config, queues, `.env` files, or tokens.

## Development

Run `npm test --prefix apps/extension` before opening a pull request. The
package check is `python3 scripts/package-extension.py`. Keep changes scoped
to one issue and update documentation when user-visible behavior changes.

## Reporting a provider breakage

Use the provider-breakage issue template. Include the provider, page URL path
(without account parameters), plan, visible safe error code, and a sanitized
description of the page change—never credentials, cookies, or full page text.
