const ENDPOINT = "http://127.0.0.1:8787/collect";
const SUSPICION_CONFIRMATIONS_REQUIRED = 2;
const SUSPICION_MAX_AGE_MS = 10 * 60 * 1000;
const SUSPICION_RETRY_DELAY_MS = 30 * 1000;
const REQUIRED_TABS = [
  { key: "kilo-credit", url: "https://app.kilo.ai/credits", match: "app.kilo.ai/credits" },
  { key: "openai-api-credit", url: "https://platform.openai.com/home", match: "platform.openai.com/home" },
  { key: "claude-api-credit", url: "https://platform.claude.com/dashboard", match: "platform.claude.com/dashboard" },
  { key: "chatgpt-weekly", url: "https://chatgpt.com/#settings/Usage", match: "#settings/Usage" },
  { key: "claude-usage-credit", keys: ["claude-usage-credit", "claude-session", "claude-weekly", "claude-fable", "claude-usage-cap"], url: "https://claude.ai/new#settings/usage", match: "claude.ai/new#settings/usage" },
];
let activeCollection = null;

chrome.runtime.onInstalled.addListener(initializeSchedule);
chrome.runtime.onStartup.addListener(syncSchedule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.autoCollectionEnabled || changes.collectionIntervalMinutes)) syncSchedule();
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "collect" && alarm.name !== "collect-retry") return;
  const { autoCollectionEnabled = true } = await chrome.storage.local.get("autoCollectionEnabled");
  if (!autoCollectionEnabled) return;
  if (alarm.name === "collect") return collect(REQUIRED_TABS);
  const { pendingSuspicion = {} } = await chrome.storage.local.get("pendingSuspicion");
  const pendingKeys = new Set(Object.keys(pendingSuspicion));
  const targets = REQUIRED_TABS.filter((target) => (target.keys ?? [target.key]).some((key) => pendingKeys.has(key)));
  if (targets.length) collect(targets);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "focus-provider") {
    focusProvider(message.key).then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  const targets = message?.type === "collect" ? REQUIRED_TABS : message?.type === "collect-provider" ? REQUIRED_TABS.filter((target) => target.key === message.key) : [];
  if (!targets.length) return;
  collect(targets).then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function focusProvider(key) {
  const target = REQUIRED_TABS.find((candidate) => candidate.key === key || candidate.keys?.includes(key));
  if (!target) return { ok: false, error: "No provider page is configured for this item." };
  const candidates = (await chrome.tabs.query({})).filter((tab) => tab.url?.includes(target.match));
  if (candidates.length) {
    const tab = candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    await chrome.tabs.update(tab.id, { active: true });
    return { ok: true, opened: false };
  }
  await chrome.tabs.create({ url: target.url, active: true });
  return { ok: true, opened: true };
}

async function initializeSchedule() {
  const config = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes"]);
  await chrome.storage.local.set({
    ...(config.autoCollectionEnabled === undefined ? { autoCollectionEnabled: true } : {}),
    ...(config.collectionIntervalMinutes === undefined ? { collectionIntervalMinutes: 2 } : {}),
  });
  await syncSchedule();
}

async function syncSchedule() {
  const { autoCollectionEnabled = true, collectionIntervalMinutes = 2 } = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes"]);
  const interval = Math.max(1, Math.min(1440, Number(collectionIntervalMinutes) || 2));
  await chrome.alarms.clear("collect");
  if (autoCollectionEnabled) chrome.alarms.create("collect", { periodInMinutes: interval });
  if (!autoCollectionEnabled) await chrome.alarms.clear("collect-retry");
}

function collect(targets = REQUIRED_TABS) {
  if (activeCollection) return activeCollection;
  activeCollection = runCollection(targets).finally(() => { activeCollection = null; });
  return activeCollection;
}

async function runCollection(targets) {
  const { tabs, opened } = await ensureDashboardTabs(targets);
  await refreshTabs(tabs, opened);
  await waitForTabsReady(tabs);
  const parsedMetrics = await readWithRetries(tabs, targets.map((target) => target.key));
  const targetKeys = new Set(targets.flatMap((target) => target.keys ?? [target.key]));
  const metrics = parsedMetrics.filter((metric) => targetKeys.has(metric.key));
  const previous = await chrome.storage.local.get("latestMetrics");
  const priorByKey = Object.fromEntries((previous.latestMetrics ?? []).map((metric) => [metric.key, metric]));
  const { autoCollectionEnabled = true } = await chrome.storage.local.get("autoCollectionEnabled");
  const { verifiedMetrics: reconciledMetrics, heldMetrics } = await reconcileMetrics(metrics, priorByKey);
  const collectedAt = new Date().toISOString();
  const verifiedMetrics = reconciledMetrics.map((metric) => ({ ...metric, collectedAt }));
  const issues = heldMetrics.map((held) => autoCollectionEnabled
    ? `${held.metric.provider} returned ${held.metric.display} unexpectedly. Kept the prior verified value and will confirm automatically.`
    : `${held.metric.provider} returned ${held.metric.display} unexpectedly. Kept the prior verified value; automatic updates are paused.`);
  await chrome.alarms.clear("collect-retry");
  if (heldMetrics.length && autoCollectionEnabled) chrome.alarms.create("collect-retry", { when: Date.now() + SUSPICION_RETRY_DELAY_MS });
  const latestMetrics = Object.values(Object.fromEntries([...(previous.latestMetrics ?? []), ...verifiedMetrics].map((metric) => [metric.key, metric])));
  if (!metrics.length) return { ok: false, error: opened.length ? "Provider pages are still loading; retry in a moment." : "No readable provider values found yet." };
  if (!verifiedMetrics.length) {
    await chrome.storage.local.set({ latestMetrics, lastIssues: issues });
    return { ok: false, error: "No verified values were collected; retry shortly.", issues };
  }
  await chrome.storage.local.set({ latestMetrics, lastCollectedAt: collectedAt, lastIssues: issues });
  const { closeOpenedTabs = false, bridgeSecret = "" } = await chrome.storage.local.get(["closeOpenedTabs", "bridgeSecret"]);
  try {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-collector-secret": bridgeSecret }, body: JSON.stringify({ collectedAt, metrics: verifiedMetrics }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: "Dashboard delivery failed; local snapshot was saved." };
    if (closeOpenedTabs && opened.length) await closeTabs(opened);
    return { ok: true, accepted: result.accepted, collectedAt, opened, issues };
  } catch {
    if (closeOpenedTabs && opened.length) await closeTabs(opened);
    return { ok: false, error: "Dashboard delivery failed; local snapshot was saved." };
  }
}

function isSuspiciousReading(metric, prior) {
  return metric.kind === "credit" && metric.value === 0 && Number.isFinite(prior?.value) && prior.value > 0;
}

async function reconcileMetrics(metrics, priorByKey) {
  const now = Date.now();
  const { pendingSuspicion = {} } = await chrome.storage.local.get("pendingSuspicion");
  const nextPending = { ...pendingSuspicion };
  const verifiedMetrics = [];
  const heldMetrics = [];
  for (const metric of metrics) {
    const prior = priorByKey[metric.key];
    if (!isSuspiciousReading(metric, prior)) {
      delete nextPending[metric.key];
      verifiedMetrics.push(metric);
      continue;
    }
    const pending = nextPending[metric.key];
    const sameReading = pending?.value === metric.value;
    const streak = sameReading ? pending.streak + 1 : 1;
    const firstSeenAt = sameReading ? pending.firstSeenAt : now;
    if (streak > SUSPICION_CONFIRMATIONS_REQUIRED || now - firstSeenAt > SUSPICION_MAX_AGE_MS) {
      delete nextPending[metric.key];
      verifiedMetrics.push(metric);
      continue;
    }
    nextPending[metric.key] = { value: metric.value, firstSeenAt, streak };
    heldMetrics.push({ metric, streak, firstSeenAt });
  }
  await chrome.storage.local.set({ pendingSuspicion: nextPending });
  return { verifiedMetrics, heldMetrics };
}

async function ensureDashboardTabs(targets = REQUIRED_TABS) {
  const openTabs = await chrome.tabs.query({});
  const tabs = [];
  const opened = [];
  for (const target of targets) {
    const candidates = openTabs.filter((tab) => tab.url?.includes(target.match));
    if (candidates.length) {
      tabs.push(candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]);
    } else {
      const tab = await chrome.tabs.create({ url: target.url, active: false, pinned: true });
      tabs.push(tab);
      opened.push(tab.id);
    }
  }
  return { tabs, opened };
}

async function refreshTabs(tabs, openedTabIds) {
  await Promise.all(tabs.filter((tab) => !openedTabIds.includes(tab.id)).map(async (tab) => {
    try { await chrome.tabs.reload(tab.id); } catch { /* A closed or unavailable tab will be retried on the next pass. */ }
  }));
}

async function waitForTabsReady(tabs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(tabs.map(async (tab) => {
      try { return (await chrome.tabs.get(tab.id)).status; } catch { return "closed"; }
    }));
    if (states.every((status) => status === "complete" || status === "closed")) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function closeTabs(tabIds) {
  try { await chrome.tabs.remove(tabIds); } catch { /* Tabs may have been closed manually. */ }
}

async function readWithRetries(tabs, requiredKeys) {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const results = await Promise.all(tabs.map(async (tab) => {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status !== "complete") return [];
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: parseVisibleMetrics });
        return result || [];
      } catch { return []; }
    }));
    const metrics = results.flat();
    if (requiredKeys.every((key) => metrics.some((metric) => metric.key === key)) || attempt === maxAttempts - 1) return metrics;
    await new Promise((resolve) => setTimeout(resolve, 1500));
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
  const kiloBalance = () => {
    const labels = ["Remaining Credits", "Available Credits", "Credit Balance", "Current Balance"];
    for (const labelText of labels) {
      const label = [...document.querySelectorAll("*")].find((element) => element.children.length === 0 && element.textContent?.trim().toLowerCase() === labelText.toLowerCase());
      const card = label?.parentElement?.parentElement;
      const cardAmount = card?.innerText.match(currencyToken)?.[0];
      if (cardAmount) return cardAmount;
      const nearbyAmount = moneyAfter(labelText);
      if (nearbyAmount) return nearbyAmount;
    }
    return null;
  };
  const quotaWindow = (label) => {
    const lowerText = text.toLowerCase();
    const lowerLabel = label.toLowerCase();
    const indexes = [];
    for (let index = lowerText.indexOf(lowerLabel); index >= 0; index = lowerText.indexOf(lowerLabel, index + lowerLabel.length)) indexes.push(index);
    return indexes.reverse().map((index) => text.slice(index, index + 120)).find((window) => /\d+%\s*(?:remaining|used)/i.test(window));
  };
  const remainingPercentAfter = (label) => {
    const match = quotaWindow(label)?.match(/(\d+)%\s*(remaining|used)/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return /used/i.test(match[2]) ? 100 - amount : amount;
  };
  const resetAfter = (label) => {
    const window = quotaWindow(label);
    return window?.match(/Resets[^\n]+/i)?.[0];
  };
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
  if (location.hostname === "app.kilo.ai") addCredit("kilo-credit", "Kilo Balance", "Remaining credits", kiloBalance());
  if (location.hostname === "platform.openai.com") addCredit("openai-api-credit", "OpenAI API Balance", "Prepaid API credit", moneyAfter("Credit balance"));
  if (location.hostname === "platform.claude.com") addCredit("claude-api-credit", "Claude API Balance", "Organization credits", moneyAfter("Organization credits"));
  if (location.hostname === "chatgpt.com") addQuota("chatgpt-weekly", "ChatGPT Plus", "Weekly usage", remainingPercentAfter("Weekly usage limit"), resetAfter("Weekly usage limit"));
  if (location.hostname === "claude.ai") {
    addQuota("claude-session", "Claude Pro", "Current session", remainingPercentAfter("Current session"), resetAfter("Current session"));
    addQuota("claude-weekly", "Claude Pro", "Weekly · all models", remainingPercentAfter("All models"), resetAfter("All models"));
    addQuota("claude-fable", "Claude Pro", "Weekly · Fable", remainingPercentAfter("Fable"), resetAfter("Fable"));
    addCredit("claude-usage-credit", "Claude.ai Balance", "Usage-credit balance", moneyBefore("Current balance") ?? moneyAfter("Current balance"));
    addQuota("claude-usage-cap", "Claude usage", "Monthly spending cap", remainingPercentAfter("Usage credits"), resetAfter("Usage credits"));
  }
  return out;
}
