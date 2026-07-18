# Chrome Web Store permission justifications

Draft copy for the Chrome Web Store listing and privacy-practices review.

| Permission | Why Capacity Monitor needs it |
| --- | --- |
| `alarms` | Runs the user-selected collection interval and bounded retry timers. |
| `scripting` | Reads only the displayed balance and plan-limit values on a provider site the user has explicitly enabled. |
| `storage` | Keeps the latest readings, safe diagnostics, user preferences, optional publishing configuration, and a bounded retry queue in the local browser profile. |
| `tabs` | Finds a provider page the user already has open, opens it when needed, and reloads it to collect a current displayed value. |
| Optional provider host access | Requested one provider at a time, only after the user enables that provider in Settings or guided setup. |
| Optional publishing host access | Requested only after the user acknowledges and saves a local bridge or HTTPS webhook destination. |

The extension's single purpose is to display the user's selected AI-service
credit balances and plan limits. It does not request blanket provider access
at installation.
