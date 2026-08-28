# Support matrix

Capacity Monitor reads only the listed displayed values. A provider must be
enabled and signed in before collection.

| Provider | Page | Metrics | Verified plans / limitations |
| --- | --- | --- | --- |
| Kilo | `app.kilo.ai/credits` | Remaining credits (USD) | Kilo credits page. The reader recognizes **Your credit balance** and older card labels; it does not use monthly-usage totals. |
| OpenAI Platform | `platform.openai.com/home` | Prepaid API credit (USD) | Platform credit-balance display. Organization-specific billing layouts may differ. |
| ChatGPT | `chatgpt.com/#settings/Usage` | 5-hour and weekly usage remaining | ChatGPT Plus plan limits. The reader accepts the current “% left” wording and the legacy weekly-label layout. Other plans are not yet verified. |
| Claude.ai | `claude.ai/new#settings/usage` | Usage-credit balance; current session; weekly all-models; monthly usage-credit cap | Claude Pro usage screen. The Fable-specific limit is currently absent; Max and future plan layouts are unverified. |
| Claude Platform | `platform.claude.com/settings/billing` | Remaining balance (USD) | Claude API prepaid-credit balance. |
| xAI Console | `console.x.ai/` | Credits remaining (USD) | Console credit display. |
| Grok | `grok.com/?q=&reasoningMode=none&voice=false&_s=usage` | Weekly usage remaining; Extra Usage Credits (USD) | Consumer Grok weekly limit and separately purchased usage-credit balance. |
| Gemini | `gemini.google.com/usage` | Current and weekly usage remaining | Gemini Pro usage limits. Gemini API postpay billing balance is deliberately not supported because it is a different product surface. |
| Google One | `one.google.com/ai/activity` | AI credits (count) | Google One AI credit count; this is not a dollar balance. |

The extension records a safe state rather than inventing a value when a page is
signed out, unavailable, missing permission, or structurally changed.
