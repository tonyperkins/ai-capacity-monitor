const ENDPOINT = "http://127.0.0.1:8787/collect";
const REQUIRED_TABS = [
  { url: "https://app.kilo.ai/profile", match: "app.kilo.ai/profile" },
  { url: "https://platform.openai.com/home", match: "platform.openai.com/home" },
  { url: "https://platform.claude.com/dashboard", match: "platform.claude.com/dashboard" },
  { url: "https://chatgpt.com/#settings/Usage", match: "#settings/Usage" },
  { url: "https://claude.ai/new#settings/usage", match: "claude.ai/new#settings/usage" },
];

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("collect", { periodInMinutes: 2 }));
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "collect") collect(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "collect") return;
  collect().then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function collect() {
  const { tabs, opened } = await ensureDashboardTabs();
  const metrics = await readWithRetries(tabs);
  const previous = await chrome.storage.local.get("latestMetrics");
  const priorByKey = Object.fromEntries((previous.latestMetrics ?? []).map((metric) => [metric.key, metric]));
  const issues = [];
  const verifiedMetrics = metrics.filter((metric) => {
    if (metric.key === "kilo-credit" && metric.value === 0 && priorByKey[metric.key]?.value > 0) {
      issues.push("Kilo returned $0.00 unexpectedly. Kept the prior verified balance; retry collection after the Kilo page finishes loading.");
      return false;
    }
    return true;
  });
  const latestMetrics = Object.values(Object.fromEntries([...(previous.latestMetrics ?? []), ...verifiedMetrics].map((metric) => [metric.key, metric])));
  if (!metrics.length) return { ok: false, error: opened ? "Provider pages are still loading; retry in a moment." : "No readable provider values found yet." };
  if (!verifiedMetrics.length) {
    await chrome.storage.local.set({ latestMetrics, lastIssues: issues });
    return { ok: false, error: "No verified values were collected; retry shortly.", issues };
  }
  const collectedAt = new Date().toISOString();
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectedAt, metrics: verifiedMetrics }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: "Dashboard delivery failed." };
  await chrome.storage.local.set({ latestMetrics, lastCollectedAt: collectedAt, lastIssues: issues });
  return { ok: true, accepted: result.accepted, collectedAt, opened, issues };
}

async function ensureDashboardTabs() {
  const openTabs = await chrome.tabs.query({});
  const tabs = [];
  let opened = 0;
  for (const target of REQUIRED_TABS) {
    const candidates = openTabs.filter((tab) => tab.url?.includes(target.match));
    if (candidates.length) {
      tabs.push(candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]);
    } else {
      tabs.push(await chrome.tabs.create({ url: target.url, active: false, pinned: true }));
      opened += 1;
    }
  }
  return { tabs, opened };
}

async function readWithRetries(tabs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const results = await Promise.all(tabs.map(async (tab) => {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status !== "complete") return [];
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: parseVisibleMetrics });
        return result || [];
      } catch { return []; }
    }));
    const metrics = results.flat();
    const essentials = ["kilo-credit", "openai-api-credit", "claude-api-credit", "claude-usage-credit", "chatgpt-weekly"];
    const kiloIsZero = metrics.some((metric) => metric.key === "kilo-credit" && metric.value === 0);
    if ((essentials.every((key) => metrics.some((metric) => metric.key === key)) && !kiloIsZero) || attempt === 2) return metrics;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return [];
}

function parseVisibleMetrics() {
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
  const percentAfter = (label) => { const match = text.match(new RegExp(`${label}[\\s\\S]{0,180}?(\\d+)%\\s*(?:remaining|used)`, "i")); return match ? Number(match[1]) : null; };
  const money = (value) => {
    const normalized = value.replace(/[\s$,()]/g, "");
    return Number(value.includes("(") ? `-${normalized}` : normalized);
  };
  const moneyDisplay = (value) => {
    const amount = money(value);
    return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
  };
  const out = [];
  const addCredit = (key, provider, label, value) => value && out.push({ key, provider, label, kind: "credit", value: money(value) * 100, display: moneyDisplay(value) });
  const addQuota = (key, provider, label, remaining, resetText) => Number.isFinite(remaining) && out.push({ key, provider, label, kind: "quota", value: remaining, display: `${remaining}%`, resetText });
  if (location.hostname === "app.kilo.ai") addCredit("kilo-credit", "Kilo Balance", "Remaining credits", moneyAfter("Remaining Credits"));
  if (location.hostname === "platform.openai.com") addCredit("openai-api-credit", "OpenAI API Balance", "Prepaid API credit", moneyAfter("Credit balance"));
  if (location.hostname === "platform.claude.com") addCredit("claude-api-credit", "Claude API Balance", "Organization credits", moneyAfter("Organization credits"));
  if (location.hostname === "chatgpt.com") addQuota("chatgpt-weekly", "ChatGPT Plus", "Weekly usage", percentAfter("Weekly usage limit"), text.match(/Resets[^\n]+/)?.[0]);
  if (location.hostname === "claude.ai") {
    addQuota("claude-session", "Claude Pro", "Current session", 100 - (percentAfter("Current session") ?? 0));
    addQuota("claude-weekly", "Claude Pro", "Weekly · all models", 100 - (percentAfter("All models") ?? 0));
    addQuota("claude-fable", "Claude Pro", "Weekly · Fable", 100 - (percentAfter("Fable") ?? 0));
    addCredit("claude-usage-credit", "Claude.ai Balance", "Usage-credit balance", moneyBefore("Current balance") ?? moneyAfter("Current balance"));
    const used = percentAfter("Usage credits"); if (used !== null) addQuota("claude-usage-cap", "Claude usage", "Monthly spending cap", 100 - used, text.match(/Resets[^\n]+/)?.[0]);
  }
  return out;
}
