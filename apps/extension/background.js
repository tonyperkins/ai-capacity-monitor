importScripts("providers.js");

const ENDPOINT = "http://127.0.0.1:8787/collect";
const SUSPICION_CONFIRMATIONS_REQUIRED = 2;
const SUSPICION_MAX_AGE_MS = 10 * 60 * 1000;
const SUSPICION_RETRY_DELAY_MS = 30 * 1000;
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
  if (alarm.name === "collect") return collect(PROVIDERS);
  const { pendingSuspicion = {} } = await chrome.storage.local.get("pendingSuspicion");
  const pendingKeys = new Set(Object.keys(pendingSuspicion));
  const targets = PROVIDERS.filter((target) => target.metrics.some((metric) => pendingKeys.has(metric.key)));
  if (targets.length) collect(targets);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "focus-provider") {
    focusProvider(message.key).then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  const targets = message?.type === "collect" ? PROVIDERS : message?.type === "collect-provider" ? PROVIDERS.filter((target) => target.metrics.some((metric) => metric.key === message.key)) : [];
  if (!targets.length) return;
  collect(targets).then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function focusProvider(key) {
  const target = PROVIDERS.find((candidate) => candidate.metrics.some((metric) => metric.key === key));
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
    ...(config.collectionIntervalMinutes === undefined ? { collectionIntervalMinutes: 20 } : {}),
  });
  await syncSchedule();
}

async function syncSchedule() {
  const { autoCollectionEnabled = true, collectionIntervalMinutes = 20 } = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes"]);
  const interval = Math.max(1, Math.min(1440, Number(collectionIntervalMinutes) || 20));
  await chrome.alarms.clear("collect");
  if (autoCollectionEnabled) chrome.alarms.create("collect", { periodInMinutes: interval });
  if (!autoCollectionEnabled) await chrome.alarms.clear("collect-retry");
}

function collect(targets = PROVIDERS) {
  if (activeCollection) return activeCollection;
  activeCollection = runCollection(targets).finally(() => { activeCollection = null; });
  return activeCollection;
}

async function runCollection(targets) {
  const { tabs, opened } = await ensureDashboardTabs(targets);
  await refreshTabs(tabs, opened);
  await waitForTabsReady(tabs);
  const parsedMetrics = await readWithRetries(tabs, targets);
  const targetKeys = new Set(targets.flatMap((target) => target.metrics.map((metric) => metric.key)));
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
  const snapshot = {
    version: "1",
    collectedAt,
    metrics: verifiedMetrics.map((metric) => ({ ...metric, unit: metric.unit ?? (metric.kind === "credit" ? "usd" : "percent"), status: "verified" })),
    issues,
  };
  try {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-collector-secret": bridgeSecret }, body: JSON.stringify(snapshot) });
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

async function ensureDashboardTabs(targets = PROVIDERS) {
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

async function readWithRetries(tabs, targets) {
  const maxAttempts = 10;
  const requiredKeys = targets.map((target) => target.metrics[0].key);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const results = await Promise.all(tabs.map(async (tab, index) => {
      const spec = { hostname: targets[index].hostname, metrics: targets[index].metrics };
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status !== "complete") return [];
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readProviderMetrics, args: [spec] });
        return result || [];
      } catch { return []; }
    }));
    const metrics = results.flat();
    if (requiredKeys.every((key) => metrics.some((metric) => metric.key === key)) || attempt === maxAttempts - 1) return metrics;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return [];
}

