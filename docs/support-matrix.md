# Support matrix

Capacity Monitor reads only the listed displayed values. A provider must be
enabled and signed in before collection.

| Provider | Page | Metrics | Verified plans / limitations |
| --- | --- | --- | --- |
| Kilo | `app.kilo.ai/credits` | Remaining credits (USD) | Kilo credits page. The reader recognizes **Your credit balance** and older card labels; it does not use monthly-usage totals. |
| OpenAI Platform | `platform.openai.com/home` | Prepaid API credit (USD) | Platform credit-balance display. Organization-specific billing layouts may differ. |
| ChatGPT | `chatgpt.com/#settings/Usage` | 5-hour and weekly usage remaining | ChatGPT Plus plan limits. The reader accepts the current “% left” wording and the legacy weekly-label layout. When a weekly limit is readable and the five-hour heading is absent (as reported on Pro), the five-hour card and cached reading are removed automatically. The card returns if that window reappears. |
| Claude.ai | `claude.ai/new#settings/usage` | Usage-credit balance; current session; weekly all-models; monthly usage-credit cap | Claude Pro usage screen, including “This week,” the usage-credit total, and “No spend limit”; older labels remain supported. The Fable-specific limit is currently absent; Max and future plan layouts are unverified. |
| Claude Platform | `platform.claude.com/settings/billing` | Remaining balance (USD) | Claude API prepaid-credit balance. |
| xAI Console | `console.x.ai/` | Credits remaining (USD) | Console credit display. |
| Grok / Cursor (X Subscription) | `grok.com/dashboard/` | Shared weekly usage remaining; shared additional credits (USD) | One pool across eligible Grok, Cursor, and Grok Bot usage. Reads “Weekly included usage” and “Credits available”; retains legacy Grok headings. Provider-reported weekly unavailability stays unavailable. On the spending-only overview (Account balance / Monthly additional usage), the credit card and its cached value are removed when no credit-balance label is exposed; monthly spending is never substituted for remaining credits. A readable credit balance restores the card automatically. |
| Gemini | `gemini.google.com/usage` | Current and weekly usage remaining | Gemini Pro usage limits. Gemini API postpay billing balance is deliberately not supported because it is a different product surface. |
| Google One | `one.google.com/ai/activity` | AI credits (count) | Google One AI credit count; this is not a dollar balance. |

The extension records a safe state rather than inventing a value when a page is
signed out, unavailable, missing permission, or structurally changed.

### X Subscription billing

The [X Subscription usage rules](https://docs.x.ai/x-subscription/usage-limits) describe one weekly first-party usage pool per seat and additional usage credits for overage and third-party Cursor models. The Grok adapter collects the shared totals once; product breakdowns must not be added as separate allowances. Existing `grok-weekly` and `grok-extra-credit` keys are preserved for saved history and displays. The xAI Console adapter remains a separate reading of its displayed API balance. Legacy subscriptions can remain active until the user switches plans; this change does not link accounts or alter subscriptions.

Verified October 19, 2026 against the authenticated Premium dashboard: “Credits available” showed $0.00; weekly usage reported temporarily unavailable. Weekly headings and legacy layouts are covered by parser regression tests.

The Grok collector waits for both shared metrics instead of finishing when credits arrive first, with up to 12 reads spaced 1.5 seconds apart within the collection deadline. If weekly usage is missing, it attempts the Current plan card’s Refresh control once when available. Valid credits are retained even when weekly usage does not recover.
