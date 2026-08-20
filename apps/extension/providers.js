// Provider registry: the single source of truth for every supported provider.
// Loaded by the service worker (importScripts) and the popup (script tag);
// tests evaluate this file directly.
//
// Each provider declares its page, tab-match pattern, and metrics. Each metric
// carries display metadata (provider/label/kind/unit, quota reset window) and
// a declarative `read` spec interpreted by the fixed engine below. Parsing is
// data, not per-provider code: readProviderMetrics is injected into provider
// tabs via chrome.scripting.executeScript, which serializes one function and
// its JSON arguments — closures and per-provider functions cannot cross that
// boundary, and a constrained spec language is also what a future signed
// remote-profile system requires.
//
// Provider order matters: the popup derives balance/quota display order from
// metric order across this array.

const PROVIDERS = [
  {
    id: "kilo",
    name: "Kilo",
    hostname: "app.kilo.ai",
    url: "https://app.kilo.ai/credits",
    match: "app.kilo.ai/credits",
    collection: { readyTimeoutMs: 12000, maxAttempts: 4, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "kilo-credit", provider: "Kilo Balance", label: "Remaining credits", kind: "credit", unit: "usd", read: { type: "labeled-card-money", labels: ["Your credit balance", "Remaining Credits", "Available Credits", "Credit Balance", "Current Balance"] } },
    ],
  },
  {
    id: "openai-platform",
    name: "OpenAI Platform",
    hostname: "platform.openai.com",
    url: "https://platform.openai.com/home",
    match: "platform.openai.com/home",
    collection: { readyTimeoutMs: 12000, maxAttempts: 3, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "openai-api-credit", provider: "OpenAI API Balance", label: "Prepaid API credit", kind: "credit", unit: "usd", read: { type: "money-after", label: "Credit balance" } },
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    hostname: "chatgpt.com",
    url: "https://chatgpt.com/#settings/Usage",
    match: "#settings/Usage",
    collection: { readyTimeoutMs: 12000, maxAttempts: 4, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "chatgpt-weekly", provider: "ChatGPT Plus", label: "Weekly usage", kind: "quota", unit: "percent", resetWindowMs: 7 * 24 * 60 * 60 * 1000, read: { type: "quota", label: "Weekly usage limit" } },
    ],
  },
  {
    id: "claude-app",
    name: "Claude.ai",
    hostname: "claude.ai",
    url: "https://claude.ai/new#settings/usage",
    match: "claude.ai/new#settings/usage",
    collection: { readyTimeoutMs: 15000, maxAttempts: 4, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "claude-usage-credit", provider: "Claude.ai Balance", label: "Usage-credit balance", kind: "credit", unit: "usd", read: { type: "money-before-or-after", label: "Current balance" } },
      { key: "claude-session", provider: "Claude Pro", label: "Current session", kind: "quota", unit: "percent", resetWindowMs: 5 * 60 * 60 * 1000, read: { type: "quota", label: "Current session" } },
      { key: "claude-weekly", provider: "Claude Pro", label: "Weekly · all models", kind: "quota", unit: "percent", resetWindowMs: 7 * 24 * 60 * 60 * 1000, read: { type: "quota", label: "All models" } },
      // Claude removed the Fable-specific limit from its current usage page.
      // Restore this metric if the provider exposes that separate limit again.
      // { key: "claude-fable", provider: "Claude Pro", label: "Weekly · Fable", kind: "quota", unit: "percent", resetWindowMs: 7 * 24 * 60 * 60 * 1000, read: { type: "quota", label: "Fable" } },
      { key: "claude-usage-cap", provider: "Claude usage", label: "Monthly spending cap", kind: "quota", unit: "percent", resetWindowMs: 31 * 24 * 60 * 60 * 1000, read: { type: "unlimited-or-quota", label: "Usage credits", unlimitedMarker: "Monthly spend limit" } },
    ],
  },
  {
    id: "claude-platform",
    name: "Claude Platform",
    hostname: "platform.claude.com",
    url: "https://platform.claude.com/dashboard",
    match: "platform.claude.com/dashboard",
    collection: { readyTimeoutMs: 12000, maxAttempts: 3, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "claude-api-credit", provider: "Claude API Balance", label: "Organization credits", kind: "credit", unit: "usd", read: { type: "money-after", label: "Organization credits" } },
    ],
  },
  {
    id: "xai",
    name: "xAI Console",
    hostname: "console.x.ai",
    url: "https://console.x.ai/",
    match: "console.x.ai",
    collection: { readyTimeoutMs: 12000, maxAttempts: 3, retryDelayMs: 1500 },
    authMarkers: ["log in", "sign in", "continue with google"],
    metrics: [
      { key: "xai-credit", provider: "xAI Balance", label: "Credits remaining", kind: "credit", unit: "usd", read: { type: "labeled-card-money", labels: ["Credits remaining"] } },
    ],
  },
  {
    id: "gemini-app",
    name: "Gemini",
    hostname: "gemini.google.com",
    url: "https://gemini.google.com/usage",
    match: "gemini.google.com/usage",
    collection: { readyTimeoutMs: 12000, maxAttempts: 4, retryDelayMs: 1500 },
    authMarkers: ["sign in", "choose an account", "continue with google"],
    metrics: [
      { key: "gemini-current-usage", provider: "Gemini Pro", label: "Current usage", kind: "quota", unit: "percent", resetWindowMs: 24 * 60 * 60 * 1000, read: { type: "quota", label: "Current usage" } },
      { key: "gemini-weekly", provider: "Gemini Pro", label: "Weekly limit", kind: "quota", unit: "percent", resetWindowMs: 7 * 24 * 60 * 60 * 1000, read: { type: "quota", label: "Weekly limit" } },
    ],
  },
  {
    id: "google-one",
    name: "Google One AI credits",
    hostname: "one.google.com",
    url: "https://one.google.com/ai/activity",
    match: "one.google.com/ai/activity",
    collection: { readyTimeoutMs: 12000, maxAttempts: 3, retryDelayMs: 1500 },
    authMarkers: ["sign in", "choose an account", "continue with google"],
    metrics: [
      { key: "google-ai-credit", provider: "Google AI Credits", label: "AI credits", kind: "credit", unit: "count", read: { type: "count-after", label: "AI credits" } },
    ],
  },
];

// This intentionally performs only a coarse, user-facing classification. It
// never returns page text. The collector still treats the parser result as the
// authoritative source of a metric value.
function inspectProviderPage(spec) {
  if (location.hostname !== spec.hostname) return { state: "failed", errorCode: "wrong-provider-page" };
  const href = String(location.href ?? "").toLowerCase();
  const text = String(document.body?.innerText ?? "").toLowerCase();
  const routeLooksLikeLogin = /\/(?:login|log-in|signin|sign-in|auth)(?:[/?#]|$)/.test(href);
  const hasAuthMarker = (spec.authMarkers ?? []).some((marker) => text.includes(String(marker).toLowerCase()));
  return routeLooksLikeLogin || hasAuthMarker
    ? { state: "unauthenticated", errorCode: "sign-in-required" }
    : { state: "ready", errorCode: null };
}

// Fixed parser engine. Injected into provider tabs with a single provider's
// spec as its argument, so it must stay fully self-contained: no references
// to anything defined outside this function.
function readProviderMetrics(spec) {
  if (location.hostname !== spec.hostname) return [];
  const text = document.body.innerText;
  const currencyToken = /(?:-\s*\$\s*|\$\s*-?\s*)[0-9,.]+|\(\s*\$\s*[0-9,.]+\s*\)/g;
  const moneyAfter = (label) => {
    const match = text.match(new RegExp(`${label}[\\s\\S]{0,160}?((?:-\\s*\\$\\s*|\\$\\s*-?\\s*)[0-9,.]+|\\(\\s*\\$\\s*[0-9,.]+\\s*\\))`, "i"));
    return match ? match[1] : null;
  };
  const moneyBefore = (label) => {
    const index = text.toLowerCase().lastIndexOf(label.toLowerCase());
    if (index < 0) return null;
    const candidates = [...text.slice(Math.max(0, index - 120), index).matchAll(currencyToken)];
    return candidates.at(-1)?.[0] ?? null;
  };
  const labeledCardMoney = (labels) => {
    for (const labelText of labels) {
      const label = [...document.querySelectorAll("*")].find((element) => element.children.length === 0 && element.textContent?.trim().toLowerCase() === labelText.toLowerCase());
      // Walk outward from the exact label and stop at the smallest container
      // that also contains a currency value. Responsive dashboards can flatten
      // neighboring cards into a misleading text order (xAI's usage amount can
      // otherwise appear closer than its remaining-credit balance).
      for (let container = label?.parentElement, depth = 0; container && depth < 6; container = container.parentElement, depth += 1) {
        const cardAmount = container.innerText.match(currencyToken)?.[0];
        if (cardAmount) return cardAmount;
      }
      const nearbyAmount = moneyAfter(labelText);
      if (nearbyAmount) return nearbyAmount;
    }
    return null;
  };
  const countAfter = (label) => {
    const match = text.match(new RegExp(`${label}[\\s\\S]{0,160}?(\\d{1,3}(?:,\\d{3})*)`, "i"));
    return match ? Number(match[1].replace(/,/g, "")) : null;
  };
  const quotaWindow = (label) => {
    const lowerText = text.toLowerCase();
    const lowerLabel = label.toLowerCase();
    const indexes = [];
    for (let index = lowerText.indexOf(lowerLabel); index >= 0; index = lowerText.indexOf(lowerLabel, index + lowerLabel.length)) indexes.push(index);
    return indexes.reverse().map((index) => {
      const maximumEnd = index + 600;
      const nextMetricStart = spec.metrics
        .map((metric) => metric.read?.label)
        .filter((candidate) => candidate && candidate.toLowerCase() !== lowerLabel)
        .map((candidate) => lowerText.indexOf(candidate.toLowerCase(), index + lowerLabel.length))
        .filter((candidateIndex) => candidateIndex >= 0)
        .reduce((nearest, candidateIndex) => Math.min(nearest, candidateIndex), maximumEnd);
      return text.slice(index, Math.min(maximumEnd, nextMetricStart));
    }).find((window) => /\d+%\s*(?:remaining|used)/i.test(window));
  };
  const labelWindows = (label, length = 600) => {
    const lowerText = text.toLowerCase();
    const lowerLabel = label.toLowerCase();
    const indexes = [];
    for (let index = lowerText.indexOf(lowerLabel); index >= 0; index = lowerText.indexOf(lowerLabel, index + lowerLabel.length)) indexes.push(index);
    return indexes.reverse().map((index) => text.slice(index, index + length));
  };
  const remainingPercentAfter = (label) => {
    const match = quotaWindow(label)?.match(/(\d+)%\s*(remaining|used)/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return /used/i.test(match[2]) ? 100 - amount : amount;
  };
  // Reset metadata must come from the same compact window as the quota's
  // percentage. A wider fallback can cross a section boundary—for example,
  // Claude's idle "Current session" has no reset and is followed by the
  // weekly "All models" reset.
  const quotaResetAfter = (label) => quotaWindow(label)?.match(/Resets[^\n]+/i)?.[0];
  const nearbyResetAfter = (label) => labelWindows(label, 240).map((window) => window.match(/Resets[^\n]+/i)?.[0]).find(Boolean);
  const unlimitedAfter = (label, marker) => labelWindows(label).some((window) => {
    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:unlimited[\\s\\S]{0,120}${escapedMarker}|${escapedMarker}[\\s\\S]{0,120}unlimited)`, "i").test(window);
  });
  const money = (value) => {
    const normalized = value.replace(/[\s$,()]/g, "");
    return Number(value.includes("(") ? `-${normalized}` : normalized);
  };
  const moneyDisplay = (value) => {
    const amount = money(value);
    return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
  };

  const out = [];
  for (const metric of spec.metrics) {
    const base = { key: metric.key, provider: metric.provider, label: metric.label, kind: metric.kind, unit: metric.unit };
    const read = metric.read;
    if (read.type === "money-after" || read.type === "money-before-or-after" || read.type === "labeled-card-money") {
      const raw = read.type === "money-after" ? moneyAfter(read.label)
        : read.type === "money-before-or-after" ? (moneyBefore(read.label) ?? moneyAfter(read.label))
        : labeledCardMoney(read.labels);
      // The snapshot contract represents USD as integer cents. Rounding here
      // prevents binary floating-point artifacts (for example 5.10 * 100)
      // from invalidating the entire published snapshot.
      if (raw) out.push({ ...base, value: Math.round(money(raw) * 100), display: moneyDisplay(raw) });
    } else if (read.type === "count-after") {
      const count = countAfter(read.label);
      if (Number.isFinite(count)) out.push({ ...base, value: count, display: `${count.toLocaleString()} credits` });
    } else if (read.type === "quota" || read.type === "unlimited-or-quota") {
      if (read.type === "unlimited-or-quota" && unlimitedAfter(read.label, read.unlimitedMarker)) {
        out.push({ ...base, value: 100, display: "Unlimited", availability: "unlimited", resetText: nearbyResetAfter(read.label) });
        continue;
      }
      const remaining = remainingPercentAfter(read.label);
      if (Number.isFinite(remaining)) out.push({ ...base, value: remaining, display: `${remaining}%`, resetText: quotaResetAfter(read.label) });
    }
  }
  return out;
}
