# Support matrix

Capacity Monitor reads only the listed displayed values. A provider must be
enabled and signed in before collection.

| Provider | Page | Metrics | Verified plans / limitations |
| --- | --- | --- | --- |
| Kilo | `app.kilo.ai/credits` | Remaining credits (USD) | Kilo credits page. The reader recognizes **Your credit balance** and older card labels; it does not use monthly-usage totals. |
| OpenAI Platform | `platform.openai.com/home` | Prepaid API credit (USD) | Platform credit-balance display. Organization-specific billing layouts may differ. |
| ChatGPT | `chatgpt.com/#settings/Usage` | Weekly usage remaining | ChatGPT Plus weekly limit. Other plans or reset layouts are not yet verified. |
| Claude.ai | `claude.ai/new#settings/usage` | Usage-credit balance; current session; weekly all-models; monthly usage-credit cap | Claude Pro usage screen. The Fable-specific limit is currently absent; Max and future plan layouts are unverified. |
| Claude Platform | `platform.claude.com/dashboard` | Organization credits (USD) | Claude API organization-credit display. |
| xAI Console | `console.x.ai/` | Credits remaining (USD) | Console credit display. |
| Gemini | `gemini.google.com/usage` | Current and weekly usage remaining | Gemini Pro usage limits. Gemini API postpay billing balance is deliberately not supported because it is a different product surface. |
| Google One | `one.google.com/ai/activity` | AI credits (count) | Google One AI credit count; this is not a dollar balance. |

The extension records a safe state rather than inventing a value when a page is
signed out, unavailable, missing permission, or structurally changed.
