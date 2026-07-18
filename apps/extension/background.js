importScripts("providers.js", "publishing.js", "permissions.js");

const COLLECTION_DEADLINE_MS = 30 * 1000;
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
  if (changes.publishMode || changes.bridgeUrl || changes.webhookUrl) chrome.storage.local.set({ publishRetryCount: 0 }).then(() => drainPublishQueue());
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "publish-retry") return drainPublishQueue();
  if (alarm.name !== "collect" && alarm.name !== "collect-retry") return;
  const { autoCollectionEnabled = true } = await chrome.storage.local.get("autoCollectionEnabled");
  if (!autoCollectionEnabled) return;
  const enabled = await getEnabledProviders();
  if (alarm.name === "collect") return enabled.permitted.length || enabled.missing.length ? collect(enabled) : undefined;
  const { pendingSuspicion = {} } = await chrome.storage.local.get("pendingSuspicion");
  const pendingKeys = new Set(Object.keys(pendingSuspicion));
  const permitted = enabled.permitted.filter((target) => target.metrics.some((metric) => pendingKeys.has(metric.key)));
  return permitted.length ? collect({ permitted, missing: [] }) : undefined;
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "focus-provider") {
    focusProvider(message.key).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type !== "collect" && message?.type !== "collect-provider") return;
  (async () => {
    const enabled = await getEnabledProviders();
    const selection = message.type === "collect" ? enabled : {
      permitted: enabled.permitted.filter((target) => target.metrics.some((metric) => metric.key === message.key)),
      missing: enabled.missing.filter((target) => target.metrics.some((metric) => metric.key === message.key)),
    };
    return selection.permitted.length || selection.missing.length ? collect(selection) : { ok: false, error: "No providers are enabled. Choose providers in Settings." };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function getEnabledProviders() {
  const { enabledProviders = [] } = await chrome.storage.local.get("enabledProviders");
  const selected = PROVIDERS.filter((provider) => enabledProviders.includes(provider.id));
  const permission = await Promise.all(selected.map(async (provider) => ({ provider, granted: await chrome.permissions.contains({ origins: [providerOrigin(provider)] }) })));
  return { permitted: permission.filter((entry) => entry.granted).map((entry) => entry.provider), missing: permission.filter((entry) => !entry.granted).map((entry) => entry.provider) };
}

async function pruneDisabledMetrics(enabledIds) {
  const enabledKeys = new Set(PROVIDERS.filter((provider) => enabledIds.includes(provider.id)).flatMap((provider) => provider.metrics.map((metric) => metric.key)));
  const { latestMetrics = [], pendingSuspicion = {}, metricStates = {} } = await chrome.storage.local.get(["latestMetrics", "pendingSuspicion", "metricStates"]);
  const keptMetrics = latestMetrics.filter((metric) => enabledKeys.has(metric.key));
  const keptPending = Object.fromEntries(Object.entries(pendingSuspicion).filter(([key]) => enabledKeys.has(key)));
  const keptStates = Object.fromEntries(Object.entries(metricStates).filter(([key]) => enabledKeys.has(key)));
  await chrome.storage.local.set({ latestMetrics: keptMetrics, pendingSuspicion: keptPending, metricStates: keptStates });
}

async function focusProvider(key) {
  const target = PROVIDERS.find((candidate) => candidate.metrics.some((metric) => metric.key === key));
  if (!target) return { ok: false, error: "No provider page is configured for this item." };
  if (!await chrome.permissions.contains({ origins: [providerOrigin(target)] })) return { ok: false, error: "Permission needed. Grant access in Settings before opening this provider." };
  const candidates = (await chrome.tabs.query({})).filter((tab) => tab.url?.includes(target.match));
  if (candidates.length) {
    await chrome.tabs.update(candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0].id, { active: true });
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
    ...(config.enabledProviders === undefined ? { enabledProviders: details?.reason === "update" ? PROVIDERS.map((provider) => provider.id) : [] } : {}),
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

function collect(selection) {
  if (activeCollection) return activeCollection;
  activeCollection = runCollection(selection).finally(() => { activeCollection = null; });
  return activeCollection;
}

async function runCollection({ permitted: targets = [], missing = [] }) {
  const startedAt = Date.now();
  const deadline = startedAt + COLLECTION_DEADLINE_MS;
  const { tabs, opened } = await ensureDashboardTabs(targets);
  await refreshTabs(tabs, opened);
  await waitForTabsReady(tabs, targets, deadline);
  const outcomes = [...await readWithRetries(tabs, targets, deadline), ...missing.map((target) => ({ target, metrics: [], state: "permission-needed", errorCode: "permission-needed", attemptedAt: new Date().toISOString() }))];
  const targetKeys = new Set([...targets, ...missing].flatMap((target) => target.metrics.map((metric) => metric.key)));
  const previous = await chrome.storage.local.get(["latestMetrics", "metricStates", "pendingSuspicion", "autoCollectionEnabled"]);
  const priorByKey = Object.fromEntries((previous.latestMetrics ?? []).map((metric) => [metric.key, metric]));
  const nextPending = { ...(previous.pendingSuspicion ?? {}) };
  const nextByKey = Object.fromEntries((previous.latestMetrics ?? []).filter((metric) => !targetKeys.has(metric.key)).map((metric) => [metric.key, metric]));
  const nextStates = { ...(previous.metricStates ?? {}) };
  const publishedMetrics = [];
  const diagnostics = [];
  const now = Date.now();

  for (const outcome of outcomes) {
    const target = outcome.target;
    const parsedByKey = Object.fromEntries(outcome.metrics.map((metric) => [metric.key, metric]));
    for (const definition of target.metrics) {
      const attemptedAt = outcome.attemptedAt;
      const parsed = parsedByKey[definition.key];
      const prior = priorByKey[definition.key];
      let state = outcome.state === "unauthenticated" ? "unauthenticated" : outcome.state === "permission-needed" ? "permission-needed" : "failed";
      let errorCode = outcome.errorCode ?? "metric-not-found";
      let stored = null;
      if (parsed) {
        if (isSuspiciousReading(parsed, prior)) {
          const pending = nextPending[parsed.key];
          const sameReading = pending?.value === parsed.value;
          const streak = sameReading ? pending.streak + 1 : 1;
          const firstSeenAt = sameReading ? pending.firstSeenAt : now;
          if (streak >= SUSPICION_CONFIRMATIONS_REQUIRED || now - firstSeenAt > SUSPICION_MAX_AGE_MS) {
            delete nextPending[parsed.key];
            state = "validated";
            errorCode = null;
            stored = { ...parsed, collectedAt: new Date(now).toISOString(), status: "verified", readState: state, attemptedAt, errorCode };
          } else {
            nextPending[parsed.key] = { value: parsed.value, firstSeenAt, streak };
            state = "suspicious-held";
            errorCode = "suspicious-reading";
            stored = prior ? { ...prior, status: "unverified", readState: state, attemptedAt, errorCode } : null;
          }
        } else {
          delete nextPending[parsed.key];
          state = "validated";
          errorCode = null;
          stored = { ...parsed, collectedAt: new Date(now).toISOString(), status: "verified", readState: state, attemptedAt, errorCode };
        }
      } else if (prior) {
        state = outcome.state === "unauthenticated" ? "unauthenticated" : outcome.state === "permission-needed" ? "permission-needed" : "retained-prior";
        stored = { ...prior, status: "unverified", readState: state, attemptedAt, errorCode };
      }
      const diagnostic = { key: definition.key, providerId: target.id, state, errorCode, attemptedAt };
      diagnostics.push(diagnostic);
      nextStates[definition.key] = diagnostic;
      if (stored) {
        nextByKey[definition.key] = stored;
        publishedMetrics.push(stored);
      } else {
        delete nextByKey[definition.key];
      }
    }
  }
  await chrome.storage.local.set({
    latestMetrics: Object.values(nextByKey),
    metricStates: nextStates,
    pendingSuspicion: nextPending,
    lastCollectedAt: new Date(now).toISOString(),
    lastIssues: diagnostics.filter((diagnostic) => diagnostic.state !== "validated").map(diagnosticMessage),
  });
  await chrome.alarms.clear("collect-retry");
  const hasSuspicion = diagnostics.some((diagnostic) => diagnostic.state === "suspicious-held");
  if (hasSuspicion && previous.autoCollectionEnabled !== false) chrome.alarms.create("collect-retry", { when: Date.now() + SUSPICION_RETRY_DELAY_MS });
  const snapshot = { version: "1", collectedAt: new Date(now).toISOString(), metrics: publishedMetrics, diagnostics, issues: diagnostics.filter((diagnostic) => diagnostic.state !== "validated").map(diagnosticMessage) };
  const publish = await publishSnapshot(snapshot);
  const { closeOpenedTabs = false } = await chrome.storage.local.get("closeOpenedTabs");
  if (closeOpenedTabs && opened.length) await closeTabs(opened);
  const freshCount = diagnostics.filter((diagnostic) => diagnostic.state === "validated").length;
  return { ok: true, collectedAt: snapshot.collectedAt, opened, diagnostics, issues: snapshot.issues, publish, freshCount, deadlineReached: Date.now() >= deadline };
}

function diagnosticMessage(diagnostic) {
  const metric = PROVIDERS.flatMap((provider) => provider.metrics).find((candidate) => candidate.key === diagnostic.key);
  const name = metric ? `${metric.provider} · ${metric.label}` : diagnostic.key;
  const messages = {
    "suspicious-held": "Reading changed unexpectedly; showing the prior verified value while it is confirmed.",
    "retained-prior": "Could not read this time; showing the last verified value.",
    unauthenticated: "Open the provider page and sign in, then collect again.",
    "permission-needed": "Grant this provider access in Settings, then collect again.",
    failed: "No reading is available yet. Open the provider page and try again.",
  };
  return `${name}: ${messages[diagnostic.state] ?? "Collection needs attention."}`;
}

function isSuspiciousReading(metric, prior) {
  return metric.kind === "credit" && metric.value === 0 && Number.isFinite(prior?.value) && prior.value > 0;
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
    await chrome.alarms.clear("publish-retry");
    await chrome.storage.local.set({ publishQueue: [], publishRetryCount: 0, publishStatus: { state: "disabled" } });
    return { state: "disabled" };
  }
  const url = mode === "bridge" ? (config.bridgeUrl || "http://127.0.0.1:8787/collect") : config.webhookUrl;
  const check = validateDestinationUrl(mode, url);
  if (!check.ok) return setPublishStatus({ state: "failed", detail: check.error });
  const destinationOrigin = originPatternForUrl(url);
  if (!destinationOrigin || !await chrome.permissions.contains({ origins: [destinationOrigin] })) return setPublishStatus({ state: "failed", detail: "permission needed for publishing destination" });
  const headers = { "content-type": "application/json" };
  if (mode === "bridge") headers["x-collector-secret"] = config.bridgeSecret ?? "";
  if (mode === "webhook" && config.webhookAuthValue) headers.authorization = config.webhookAuthValue;
  let queue = config.publishQueue ?? [];
  let rejected = null;
  while (queue.length) {
    let response;
    try { response = await fetch(url, { method: "POST", headers, body: JSON.stringify(queue[0]) }); } catch { return schedulePublishRetry(queue, config, "destination unreachable"); }
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

async function ensureDashboardTabs(targets = PROVIDERS) {
  const openTabs = await chrome.tabs.query({});
  const tabs = [];
  const opened = [];
  for (const target of targets) {
    const candidates = openTabs.filter((tab) => tab.url?.includes(target.match));
    if (candidates.length) tabs.push(candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]);
    else {
      const tab = await chrome.tabs.create({ url: target.url, active: false, pinned: true });
      tabs.push(tab);
      opened.push(tab.id);
    }
  }
  return { tabs, opened };
}

async function refreshTabs(tabs, openedTabIds) {
  await Promise.all(tabs.filter((tab) => !openedTabIds.includes(tab.id)).map(async (tab) => {
    try { await chrome.tabs.reload(tab.id); } catch { /* A closed tab is classified during collection. */ }
  }));
}

async function waitForTabsReady(tabs, targets, deadline) {
  const started = Date.now();
  const readyDeadlines = targets.map((target) => Math.min(deadline, started + (target.collection?.readyTimeoutMs ?? 12000)));
  while (Date.now() < deadline) {
    const states = await Promise.all(tabs.map(async (tab) => {
      try { return (await chrome.tabs.get(tab.id)).status; } catch { return "closed"; }
    }));
    const now = Date.now();
    if (states.every((status, index) => status === "complete" || status === "closed" || now >= readyDeadlines[index])) return;
    await sleep(Math.min(500, Math.max(0, deadline - now)));
  }
}

async function readWithRetries(tabs, targets, deadline) {
  return Promise.all(tabs.map((tab, index) => readProviderWithRetries(tab, targets[index], deadline)));
}

async function readProviderWithRetries(tab, target, deadline) {
  const policy = target.collection ?? { maxAttempts: 3, retryDelayMs: 1500 };
  let errorCode = "no-readable-values";
  let attemptedAt = new Date().toISOString();
  for (let attempt = 0; attempt < policy.maxAttempts && Date.now() < deadline; attempt += 1) {
    attemptedAt = new Date().toISOString();
    try {
      const current = await chrome.tabs.get(tab.id);
      if (current.status !== "complete") {
        errorCode = "page-still-loading";
      } else {
        const [{ result: inspection }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectProviderPage, args: [target] });
        if (inspection?.state === "unauthenticated") return { target, metrics: [], state: "unauthenticated", errorCode: inspection.errorCode, attemptedAt };
        if (inspection?.state === "failed") return { target, metrics: [], state: "failed", errorCode: inspection.errorCode, attemptedAt };
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readProviderMetrics, args: [{ hostname: target.hostname, metrics: target.metrics }] });
        if (result?.length) return { target, metrics: result, state: "validated", errorCode: null, attemptedAt };
        errorCode = "no-readable-values";
      }
    } catch {
      errorCode = "tab-unavailable";
    }
    const remaining = deadline - Date.now();
    if (attempt < policy.maxAttempts - 1 && remaining > 0) await sleep(Math.min(policy.retryDelayMs, remaining));
  }
  return { target, metrics: [], state: "failed", errorCode: Date.now() >= deadline ? "collection-deadline" : errorCode, attemptedAt };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeTabs(tabIds) {
  try { await chrome.tabs.remove(tabIds); } catch { /* Tabs may have been closed manually. */ }
}
