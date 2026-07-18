importScripts("providers.js", "publishing.js");

const SUSPICION_CONFIRMATIONS_REQUIRED = 2;
const SUSPICION_MAX_AGE_MS = 10 * 60 * 1000;
const SUSPICION_RETRY_DELAY_MS = 30 * 1000;
let activeCollection = null;
let activeDrain = null;

chrome.runtime.onInstalled.addListener((details) => initializeSchedule(details));
chrome.runtime.onStartup.addListener(syncSchedule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.autoCollectionEnabled || changes.collectionIntervalMinutes) syncSchedule();
  if (changes.enabledProviders) pruneDisabledMetrics(changes.enabledProviders.newValue ?? []);
  if (changes.publishMode || changes.bridgeUrl || changes.webhookUrl) {
    chrome.storage.local.set({ publishRetryCount: 0 }).then(() => drainPublishQueue());
  }
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "publish-retry") return drainPublishQueue();
  if (alarm.name !== "collect" && alarm.name !== "collect-retry") return;
  const { autoCollectionEnabled = true } = await chrome.storage.local.get("autoCollectionEnabled");
  if (!autoCollectionEnabled) return;
  const enabled = await getEnabledProviders();
  if (alarm.name === "collect") {
    if (enabled.length) collect(enabled);
    return;
  }
  const { pendingSuspicion = {} } = await chrome.storage.local.get("pendingSuspicion");
  const pendingKeys = new Set(Object.keys(pendingSuspicion));
  const targets = enabled.filter((target) => target.metrics.some((metric) => pendingKeys.has(metric.key)));
  if (targets.length) collect(targets);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "focus-provider") {
    focusProvider(message.key).then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type !== "collect" && message?.type !== "collect-provider") return;
  (async () => {
    const enabled = await getEnabledProviders();
    const targets = message.type === "collect" ? enabled : enabled.filter((target) => target.metrics.some((metric) => metric.key === message.key));
    if (!targets.length) return { ok: false, error: "No providers are enabled. Choose providers in Settings." };
    return collect(targets);
  })().then((result) => sendResponse(result)).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function getEnabledProviders() {
  const { enabledProviders = [] } = await chrome.storage.local.get("enabledProviders");
  return PROVIDERS.filter((provider) => enabledProviders.includes(provider.id));
}

async function pruneDisabledMetrics(enabledIds) {
  const enabledKeys = new Set(PROVIDERS.filter((provider) => enabledIds.includes(provider.id)).flatMap((provider) => provider.metrics.map((metric) => metric.key)));
  const { latestMetrics = [], pendingSuspicion = {} } = await chrome.storage.local.get(["latestMetrics", "pendingSuspicion"]);
  const keptMetrics = latestMetrics.filter((metric) => enabledKeys.has(metric.key));
  const keptPending = Object.fromEntries(Object.entries(pendingSuspicion).filter(([key]) => enabledKeys.has(key)));
  if (keptMetrics.length !== latestMetrics.length || Object.keys(keptPending).length !== Object.keys(pendingSuspicion).length) {
    await chrome.storage.local.set({ latestMetrics: keptMetrics, pendingSuspicion: keptPending });
  }
}

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

async function initializeSchedule(details) {
  const config = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes", "enabledProviders", "publishMode"]);
  await chrome.storage.local.set({
    ...(config.autoCollectionEnabled === undefined ? { autoCollectionEnabled: true } : {}),
    ...(config.collectionIntervalMinutes === undefined ? { collectionIntervalMinutes: 20 } : {}),
    // Fresh installs start with no providers enabled; an upgrade from a
    // pre-settings version keeps its existing collect-everything behavior.
    ...(config.enabledProviders === undefined ? { enabledProviders: details?.reason === "update" ? PROVIDERS.map((provider) => provider.id) : [] } : {}),
    // Publishing is opt-in for fresh installs; an upgrade keeps the previous
    // always-publish-to-local-bridge behavior so an existing pipeline doesn't
    // silently stop.
    ...(config.publishMode === undefined ? { publishMode: details?.reason === "update" ? "bridge" : "disabled" } : {}),
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
  const { closeOpenedTabs = false } = await chrome.storage.local.get("closeOpenedTabs");
  const snapshot = {
    version: "1",
    collectedAt,
    metrics: verifiedMetrics.map((metric) => ({ ...metric, unit: metric.unit ?? (metric.kind === "credit" ? "usd" : "percent"), status: "verified" })),
    issues,
  };
  const publish = await publishSnapshot(snapshot);
  if (closeOpenedTabs && opened.length) await closeTabs(opened);
  return { ok: true, collectedAt, opened, issues, publish };
}

async function publishSnapshot(snapshot) {
  const { publishMode = "disabled" } = await chrome.storage.local.get("publishMode");
  if (publishMode === "disabled") return { state: "disabled" };
  const { publishQueue = [] } = await chrome.storage.local.get("publishQueue");
  await chrome.storage.local.set({ publishQueue: [...publishQueue, snapshot].slice(-PUBLISH_QUEUE_LIMIT) });
  return drainPublishQueue();
}

function drainPublishQueue() {
  if (activeDrain) return activeDrain;
  activeDrain = runDrain().finally(() => { activeDrain = null; });
  return activeDrain;
}

async function runDrain() {
  const config = await chrome.storage.local.get(["publishMode", "bridgeUrl", "bridgeSecret", "webhookUrl", "webhookAuthValue", "publishQueue", "publishRetryCount"]);
  const mode = config.publishMode ?? "disabled";
  if (mode === "disabled") {
    // Opting out discards anything still queued: nothing leaves the device.
    await chrome.alarms.clear("publish-retry");
    await chrome.storage.local.set({ publishQueue: [], publishRetryCount: 0, publishStatus: { state: "disabled" } });
    return { state: "disabled" };
  }
  const url = mode === "bridge" ? (config.bridgeUrl || "http://127.0.0.1:8787/collect") : config.webhookUrl;
  const check = validateDestinationUrl(mode, url);
  if (!check.ok) return setPublishStatus({ state: "failed", detail: check.error });
  const headers = { "content-type": "application/json" };
  if (mode === "bridge") headers["x-collector-secret"] = config.bridgeSecret ?? "";
  if (mode === "webhook" && config.webhookAuthValue) headers["authorization"] = config.webhookAuthValue;
  let queue = config.publishQueue ?? [];
  let rejected = null;
  while (queue.length) {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(queue[0]) });
    } catch {
      return schedulePublishRetry(queue, config, "destination unreachable");
    }
    if (response.status === 429 || response.status >= 500) return schedulePublishRetry(queue, config, `destination responded ${response.status}`);
    queue = queue.slice(1);
    await chrome.storage.local.set({ publishQueue: queue, publishRetryCount: 0 });
    if (!response.ok) rejected = `destination rejected a snapshot (${response.status})`;
  }
  await chrome.alarms.clear("publish-retry");
  return setPublishStatus(rejected ? { state: "rejected", detail: rejected } : { state: "delivered", at: new Date().toISOString() });
}

async function schedulePublishRetry(queue, config, reason) {
  const retryCount = (config.publishRetryCount ?? 0) + 1;
  await chrome.storage.local.set({ publishQueue: queue, publishRetryCount: retryCount });
  chrome.alarms.create("publish-retry", { when: Date.now() + computePublishBackoffMs(retryCount) });
  return setPublishStatus({ state: "delayed", detail: reason, at: new Date().toISOString() });
}

async function setPublishStatus(status) {
  await chrome.storage.local.set({ publishStatus: status });
  return status;
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

