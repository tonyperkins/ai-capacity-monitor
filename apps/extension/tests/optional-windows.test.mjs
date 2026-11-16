import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FakeElement, loadProviders, setPage } from "./helpers.mjs";

const { PROVIDERS, readProviderMetrics } = await loadProviders();
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const collection = background.slice(background.indexOf("async function runCollection("), background.indexOf("function withResetMetadata("));
const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const popupFunctions = popup.slice(0, popup.indexOf('$("auto-updates").addEventListener'));
const target = PROVIDERS.find((provider) => provider.id === "chatgpt");

function harness(provider = target) {
  const data = { latestMetrics: [], metricStates: {}, pendingSuspicion: {} };
  let outcome;
  let snapshot;
  const chrome = {
    storage: { local: { get: async () => data, set: async (patch) => Object.assign(data, patch) } },
    alarms: { clear: async () => {}, create: () => {} },
  };
  const deps = {
    chrome, COLLECTION_DEADLINE_MS: 30000,
    ensureCollectionTabs: async () => ({ tabs: [], opened: [] }),
    refreshTabs: async () => {}, waitForTabsReady: async () => {},
    readWithRetries: async () => [outcome],
    withResetMetadata: (metric) => metric,
    isSuspiciousReading: () => false,
    diagnosticMessage: (diagnostic) => diagnostic.errorCode,
    publishSnapshot: async (value) => { snapshot = value; return {}; },
  };
  const run = new Function(...Object.keys(deps), `${collection}\nreturn runCollection;`)(...Object.values(deps));
  return { data, snapshot: () => snapshot, collect: async (text, state = "validated", dom = null) => {
    setPage({ hostname: provider.hostname, text, dom });
    outcome = { target: provider, metrics: readProviderMetrics(provider), state, attemptedAt: new Date().toISOString() };
    await run({ permitted: [provider] });
  } };
}

const both = "5-hour limit\n50% left\nResets in 2h\nWeekly limit\n81% left\nResets in 5d";
const weekly = "Weekly limit\n81% left\nResets in 5d";

test("weekly-only upgrade clears cached session, hides its card, and restores it when the window returns", async () => {
  const h = harness();
  await h.collect(both);
  assert.ok(h.data.latestMetrics.some((metric) => metric.key === "chatgpt-session"));
  await h.collect(weekly);
  assert.deepEqual(h.data.unavailableMetricKeys, ["chatgpt-session"]);
  assert.deepEqual(h.snapshot().metrics.map((metric) => metric.key), ["chatgpt-weekly"]);
  assert.deepEqual(h.snapshot().diagnostics.map((metric) => metric.key), ["chatgpt-weekly"]);
  assert.deepEqual(h.snapshot().issues, []);

  const elements = { balances: {}, quotas: {} };
  const render = new Function("PROVIDERS", "POPUP_COPY", "document", "formatMetric", "timeRemainingPercent", `${popupFunctions}\nreturn render;`)(
    PROVIDERS, { states: { validated: "Validated" } },
    { getElementById: (id) => elements[id], querySelectorAll: () => [] },
    (metric) => metric?.display ?? "—", () => null,
  );
  const draw = () => render(h.data.latestMetrics, h.data.metricStates, new Set(target.metrics.map((metric) => metric.key)), h.data.unavailableMetricKeys);
  draw();
  assert.doesNotMatch(elements.quotas.innerHTML, /5-hour|chatgpt-session/);
  assert.match(elements.quotas.innerHTML, /Weekly limit/);
  await h.collect("Loading", "failed");
  assert.deepEqual(h.data.unavailableMetricKeys, ["chatgpt-session"]);
  assert.equal(h.data.metricStates["chatgpt-session"], undefined);
  await h.collect(both);
  assert.deepEqual(h.data.unavailableMetricKeys, []);
  draw();
  assert.match(elements.quotas.innerHTML, /5-hour limit/);
});

test("failed reads retain an existing session instead of treating it as an unsupported window", async () => {
  const h = harness();
  await h.collect(both);
  await h.collect("Loading", "failed");
  assert.deepEqual(h.data.unavailableMetricKeys, []);
  assert.equal(h.data.metricStates["chatgpt-session"].state, "retained-prior");
  assert.ok(h.snapshot().metrics.some((metric) => metric.key === "chatgpt-session"));
});

const grok = PROVIDERS.find((provider) => provider.id === "grok");
const spendingOnly = "Premium\n34% used\nWeekly included usage\nResets Nov 11\nAccount balance\n$0.00 used this month\nMonthly additional usage\nMonthly additional usage limit\nNot set · Edit\nBuy credits";

test("Grok spending-only layout clears cached credits and their warnings, retaining the weekly pool", async () => {
  const h = harness(grok);
  h.data.latestMetrics = [{ ...grok.metrics[0], value: 0, display: "$0.00" }];
  h.data.metricStates["grok-extra-credit"] = { key: "grok-extra-credit", state: "retained-prior" };
  h.data.pendingSuspicion["grok-extra-credit"] = { value: 0, streak: 1 };
  const meter = new FakeElement({ attributes: { role: "meter", "aria-label": "Weekly included usage", "aria-valuetext": "34% used" } });
  await h.collect(spendingOnly, "validated", meter);
  assert.deepEqual(h.data.unavailableMetricKeys, ["grok-extra-credit"]);
  assert.deepEqual(h.snapshot().metrics.map((metric) => metric.key), ["grok-weekly"]);
  assert.equal(h.snapshot().metrics[0].value, 66);
  assert.equal(h.data.metricStates["grok-extra-credit"], undefined);
  assert.equal(h.data.pendingSuspicion["grok-extra-credit"], undefined);
  assert.deepEqual(h.snapshot().issues, []);

  const elements = { balances: {}, quotas: {} };
  const render = new Function("PROVIDERS", "POPUP_COPY", "document", "formatMetric", "timeRemainingPercent", `${popupFunctions}\nreturn render;`)(
    PROVIDERS, { states: { validated: "Validated" } },
    { getElementById: (id) => elements[id], querySelectorAll: () => [] },
    (metric) => metric?.display ?? "—", () => null,
  );
  render(h.data.latestMetrics, h.data.metricStates, new Set(grok.metrics.map((metric) => metric.key)), h.data.unavailableMetricKeys);
  assert.doesNotMatch(elements.balances.innerHTML, /grok-extra-credit|Showing prior value/);
  assert.match(elements.quotas.innerHTML, /Shared weekly limit/);

  const heading = new FakeElement({ textContent: "Credits available" });
  const card = new FakeElement({ children: [heading, new FakeElement({ textContent: "$4.25" })] });
  const restoredPage = new FakeElement({ children: [meter, card] });
  await h.collect(spendingOnly + "\nCredits available\n$4.25", "validated", restoredPage);
  assert.deepEqual(h.data.unavailableMetricKeys, []);
  assert.equal(h.data.latestMetrics.find((metric) => metric.key === "grok-extra-credit").value, 425);
});
