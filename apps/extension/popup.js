const allMetrics = PROVIDERS.flatMap((provider) => provider.metrics);
const metricDefinitions = Object.fromEntries(allMetrics.map((metric) => [metric.key, metric]));
const balanceOrder = allMetrics.filter((metric) => metric.kind === "credit").map((metric) => metric.key);
const quotaOrder = allMetrics.filter((metric) => metric.kind === "quota").map((metric) => metric.key);
const resetWindows = Object.fromEntries(allMetrics.filter((metric) => metric.resetWindowMs).map((metric) => [metric.key, metric.resetWindowMs]));
const stateText = POPUP_COPY.states;
const $ = (id) => document.getElementById(id);
let collectedAt = null;

function oldestVisibleCollectedAt(metrics = []) {
  const times = [...balanceOrder, ...quotaOrder].map((key) => metrics.find((metric) => metric.key === key)?.collectedAt).filter(Boolean).map((time) => new Date(time).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function renderUpdated() {
  if (!collectedAt) { $("updated").textContent = POPUP_COPY.noSnapshot; return; }
  const age = Math.max(0, Math.floor((Date.now() - new Date(collectedAt).getTime()) / 1000));
  const minutes = Math.floor(age / 60);
  const elapsed = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${minutes}m ${age % 60}s ago`;
  $("updated").textContent = `Updated ${formatShortTime(collectedAt)} - ${elapsed}`;
}

function timeRemainingPercent(metric) {
  const total = resetWindows[metric.key];
  if (!total || !metric.resetText) return null;
  const countdown = [...metric.resetText.matchAll(/(\d+)\s*(day|days|d|hour|hours|hr|hrs|h|min|mins|minute|minutes|m)/gi)].reduce((milliseconds, match) => milliseconds + Number(match[1]) * ({ d: 86400000, day: 86400000, days: 86400000, h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000, m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000 }[match[2].toLowerCase()] ?? 0), 0);
  if (countdown) return Math.max(0, Math.min(100, countdown / total * 100));
  const dateText = metric.resetText.replace(/^Resets\s*/i, "");
  const dateOnly = /^[A-Za-z]{3,9}\s+\d{1,2}$/.test(dateText);
  const reset = new Date(dateOnly ? `${dateText}, ${new Date().getFullYear()}` : dateText);
  if (Number.isNaN(reset.getTime())) return null;
  if (reset.getTime() < Date.now() && dateOnly) reset.setFullYear(reset.getFullYear() + 1);
  return Math.max(0, Math.min(100, (reset.getTime() - Date.now()) / total * 100));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
}

function stateFor(metric, diagnostic) {
  return diagnostic?.state ?? metric?.readState ?? (metric?.status === "verified" ? "validated" : "failed");
}

function stateMarkup(state, errorCode) {
  if (state === "validated") return "";
  const title = errorCode ? `${stateText[state]} (${errorCode})` : stateText[state];
  return `<small class="read-state" title="${escapeHtml(title)}"><i aria-hidden="true">●</i>${escapeHtml(stateText[state])}</small>`;
}

function render(metrics = [], metricStates = {}, enabledKeys = null) {
  const byKey = Object.fromEntries(metrics.map((metric) => [metric.key, metric]));
  const visibleBalances = enabledKeys ? balanceOrder.filter((key) => enabledKeys.has(key)) : balanceOrder;
  const visibleQuotas = enabledKeys ? quotaOrder.filter((key) => enabledKeys.has(key)) : quotaOrder;
  $("balances").innerHTML = visibleBalances.map((key) => {
    const definition = metricDefinitions[key];
    const metric = byKey[key];
    const diagnostic = metricStates[key];
    const state = stateFor(metric, diagnostic);
    const provider = escapeHtml(metric?.provider ?? definition.provider);
    const display = escapeHtml(formatMetric(metric));
    const title = state === "validated" ? `Open ${provider}` : `${stateText[state]}. ${diagnostic?.errorCode ?? "Open the provider page for details."}`;
    const accessibleName = `${provider} ${display}. ${stateText[state]}. Activate to open provider.`;
    return `<article class="card provider-link state-${state}" data-key="${key}" tabindex="0" role="button" aria-label="${escapeHtml(accessibleName)}" title="${escapeHtml(title)}"><div class="card-top"><span>${provider}</span><button class="card-refresh" data-key="${key}" type="button" title="Refresh ${provider}" aria-label="Refresh ${provider}">↻</button></div><strong aria-hidden="true">${display}</strong>${stateMarkup(state, diagnostic?.errorCode ?? metric?.errorCode)}</article>`;
  }).join("");
  $("quotas").innerHTML = visibleQuotas.map((key) => {
    const definition = metricDefinitions[key];
    const metric = byKey[key];
    const diagnostic = metricStates[key];
    const state = stateFor(metric, diagnostic);
    const provider = escapeHtml(metric?.provider ?? definition.provider);
    const label = escapeHtml(metric?.label ?? definition.label);
    const display = escapeHtml(formatMetric(metric));
    const resetText = metric?.resetText ? escapeHtml(metric.resetText) : "";
    const timePercent = metric ? timeRemainingPercent(metric) : null;
    const meter = metric ? `<div class="meter" role="progressbar" aria-label="${label}: ${display} remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, metric.value))}"><i style="width:${Math.max(0, Math.min(100, metric.value))}%"></i></div>` : "";
    const timeMeter = timePercent === null ? "" : `<div class="time-meter" role="progressbar" aria-label="Time remaining until reset" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(timePercent)}" aria-valuetext="${resetText || "Time remaining until reset"}"><i style="width:${timePercent}%"></i></div>`;
    const title = state === "validated" ? `Open ${provider}` : `${stateText[state]}. ${diagnostic?.errorCode ?? "Open the provider page for details."}`;
    const accessibleName = `${provider}, ${label}: ${display}${metric ? " remaining" : ""}. ${resetText || stateText[state]}. Activate to open provider.`;
    return `<article class="quota provider-link state-${state}" data-key="${key}" tabindex="0" role="button" aria-label="${escapeHtml(accessibleName)}" title="${escapeHtml(title)}"><div class="quota-top"><div><span>${provider} · ${label}</span>${resetText ? `<small>${resetText}</small>` : stateMarkup(state, diagnostic?.errorCode ?? metric?.errorCode)}</div><strong aria-hidden="true">${display}${metric ? " remaining" : ""}</strong></div>${meter}${timeMeter}</article>`;
  }).join("");
  document.querySelectorAll(".provider-link").forEach((item) => {
    item.addEventListener("click", (event) => { if (!event.target.closest(".card-refresh")) focusProvider(item.dataset.key); });
    item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusProvider(item.dataset.key); } });
  });
  document.querySelectorAll(".card-refresh").forEach((button) => button.addEventListener("click", () => refreshProvider(button)));
}

async function focusProvider(key) {
  $("status").textContent = POPUP_COPY.opening;
  const currentWindow = await chrome.windows.getCurrent();
  const result = await chrome.runtime.sendMessage({ type: "focus-provider", key, windowId: currentWindow.id });
  if (!result?.ok) { $("status").textContent = POPUP_COPY.checkTabs; $("updated").textContent = result?.error ?? "Unable to open provider"; $("updated").className = "error"; }
}

async function load() {
  const data = await chrome.storage.local.get(["latestMetrics", "metricStates", "lastCollectedAt", "closeOpenedTabs", "autoCollectionEnabled", "enabledProviders", "onboardingCompleted"]);
  const enabledIds = data.enabledProviders ?? [];
  const enabledKeys = new Set(PROVIDERS.filter((provider) => enabledIds.includes(provider.id)).flatMap((provider) => provider.metrics.map((metric) => metric.key)));
  const visibleMetrics = (data.latestMetrics ?? []).filter((metric) => enabledKeys.has(metric.key));
  const visibleStates = Object.fromEntries(Object.entries(data.metricStates ?? {}).filter(([key]) => enabledKeys.has(key)));
  render(visibleMetrics, visibleStates, enabledKeys);
  $("close-opened-tabs").checked = Boolean(data.closeOpenedTabs);
  $("auto-updates").checked = data.autoCollectionEnabled !== false;
  // This is the time the collection pass finished, not the age of every
  // individual reading. A retained prior reading is already marked on its
  // card; using its timestamp here made a fresh successful collection look
  // stale in the popup footer.
  collectedAt = data.lastCollectedAt ?? oldestVisibleCollectedAt(visibleMetrics) ?? null;
  renderUpdated();
  const attention = Object.values(visibleStates).some((state) => state.state !== "validated");
  $("status").textContent = !enabledIds.length ? POPUP_COPY.setup : attention ? POPUP_COPY.attention : data.lastCollectedAt ? POPUP_COPY.ready : POPUP_COPY.waiting;
  if (!enabledIds.length) $("updated").textContent = data.onboardingCompleted ? "No providers yet — choose providers in Settings" : "Set up a provider in Settings";
}

function applyCollectResult(result) {
  if (!result?.ok) { $("status").textContent = POPUP_COPY.checkTabs; $("updated").textContent = result?.error ?? "Collection failed"; $("updated").className = "error"; return; }
  $("updated").className = "";
  if (result.diagnostics?.some((diagnostic) => diagnostic.state !== "validated")) { $("status").textContent = POPUP_COPY.attention; $("updated").textContent = "Some readings need attention — see card status"; return; }
  const publish = result.publish?.state;
  if (publish === "delivered") { $("status").textContent = POPUP_COPY.sent; renderUpdated(); }
  else if (publish === "delayed") { $("status").textContent = POPUP_COPY.queued; $("updated").textContent = "Saved locally · delivery delayed, retrying automatically"; }
  else if (publish === "rejected" || publish === "failed") { $("status").textContent = POPUP_COPY.savedLocal; $("updated").textContent = `Saved locally · ${result.publish.detail ?? "delivery failed"}`; }
  else { $("status").textContent = POPUP_COPY.ready; renderUpdated(); }
}

async function refreshProvider(button) {
  button.disabled = true;
  $("status").textContent = POPUP_COPY.syncing;
  const result = await chrome.runtime.sendMessage({ type: "collect-provider", key: button.dataset.key });
  await load();
  applyCollectResult(result);
}

$("auto-updates").addEventListener("change", (event) => chrome.storage.local.set({ autoCollectionEnabled: event.target.checked }));
$("close-opened-tabs").addEventListener("change", (event) => chrome.storage.local.set({ closeOpenedTabs: event.target.checked }));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && ["latestMetrics", "metricStates", "lastCollectedAt", "autoCollectionEnabled", "enabledProviders"].some((key) => changes[key])) load(); });
$("collect").addEventListener("click", async () => {
  const button = $("collect");
  button.disabled = true;
  button.textContent = "Collecting";
  $("status").textContent = POPUP_COPY.syncing;
  const result = await chrome.runtime.sendMessage({ type: "collect" });
  await load();
  applyCollectResult(result);
  button.disabled = false;
  button.textContent = "Collect now";
});
setInterval(renderUpdated, 1000);
load();
