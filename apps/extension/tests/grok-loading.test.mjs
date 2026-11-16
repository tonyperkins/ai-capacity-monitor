import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadProviders } from "./helpers.mjs";
const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const reader = source.slice(source.indexOf("async function readProviderWithRetries("), source.indexOf("// Refresh only the usage control"));
const { PROVIDERS } = await loadProviders();
const grok = PROVIDERS.find((provider) => provider.id === "grok");

async function collect(results, clicks = true) {
  let reads = 0;
  let refreshes = 0;
  const chrome = {
    tabs: { get: async () => ({ status: "complete" }) },
    scripting: { executeScript: async ({ func }) => {
      if (func.name === "inspectProviderPage") return [{ result: { state: "ready" } }];
      if (func.name === "refreshGrokPlanUsage") { refreshes += 1; return [{ result: clicks }]; }
      return [{ result: results[Math.min(reads++, results.length - 1)] }];
    } },
  };
  const deps = { chrome, inspectProviderPage: function inspectProviderPage() {}, readProviderMetrics: function readProviderMetrics() {}, refreshGrokPlanUsage: function refreshGrokPlanUsage() {}, sleep: async () => {} };
  const run = new Function(...Object.keys(deps), `${reader}\nreturn readProviderWithRetries;`)(...Object.values(deps));
  const outcome = await run({ id: 1 }, grok, Date.now() + 30000);
  return { outcome, reads, refreshes };
}
const credits = { key: "grok-extra-credit", value: 0 };
const weekly = { key: "grok-weekly", value: 73 };

test("Grok waits beyond early credits and refreshes the missing plan usage once", async () => {
  const { outcome, reads, refreshes } = await collect([[credits], [credits], [credits], [credits, weekly]]);
  assert.equal(reads, 4);
  assert.equal(refreshes, 1);
  assert.deepEqual(outcome.metrics, [credits, weekly]);
  assert.equal(outcome.state, "validated");
});

test("Grok keeps valid credits when weekly usage never recovers", async () => {
  const { outcome, reads, refreshes } = await collect([[credits]]);
  assert.equal(reads, grok.collection.maxAttempts);
  assert.equal(refreshes, 1);
  assert.deepEqual(outcome.metrics, [credits]);
});

test("complete Grok readings finish immediately without refreshing", async () => {
  const { reads, refreshes } = await collect([[credits, weekly]]);
  assert.equal(reads, 1);
  assert.equal(refreshes, 0);
});

test("Grok spending-only overview finishes without retrying a credit card it does not expose", async () => {
  const absentCredits = { key: "grok-extra-credit", availability: "not-applicable" };
  const { outcome, reads, refreshes } = await collect([[weekly, absentCredits]]);
  assert.equal(reads, 1);
  assert.equal(refreshes, 0);
  assert.equal(outcome.state, "validated");
  assert.deepEqual(outcome.metrics, [weekly, absentCredits]);
});

test("Grok retains credits when a later attempt only exposes weekly usage", async () => {
  const { outcome, reads, refreshes } = await collect([[credits], [weekly]]);
  assert.equal(reads, 2);
  assert.equal(refreshes, 0);
  assert.equal(outcome.state, "validated");
  assert.deepEqual(outcome.metrics, [credits, weekly]);
});

test("Grok replaces an earlier credit reading with the latest successful reading", async () => {
  const latestCredits = { ...credits, value: 425 };
  const { outcome } = await collect([[credits], [latestCredits], [weekly]]);
  assert.deepEqual(outcome.metrics, [latestCredits, weekly]);
});

test("Grok keeps a successful partial reading when later attempts read no values", async () => {
  const { outcome, reads } = await collect([[credits], []]);
  assert.equal(reads, grok.collection.maxAttempts);
  assert.deepEqual(outcome.metrics, [credits]);
});

const refreshSource = source.slice(source.indexOf("function refreshGrokPlanUsage()"), source.indexOf("function sleep("));
test("plan refresh is scoped to Grok's current plan and ignores disabled controls", () => {
  let clicks = 0;
  const button = { disabled: false, textContent: "", getAttribute: (name) => name === "aria-label" ? "Refresh" : null, click: () => { clicks += 1; } };
  const main = { tagName: "MAIN" };
  const card = { tagName: "DIV", parentElement: main, querySelector: () => null, querySelectorAll: () => [button] };
  const label = { children: [], textContent: "Current plan", parentElement: card };
  const location = { hostname: "grok.com", pathname: "/dashboard/" };
  const document = { querySelectorAll: () => [label] };
  const refresh = new Function("location", "document", `${refreshSource}\nreturn refreshGrokPlanUsage;`)(location, document);
  assert.equal(refresh(), true);
  button.disabled = true;
  assert.equal(refresh(), false);
  button.disabled = false;
  location.hostname = "other.example";
  assert.equal(refresh(), false);
  location.hostname = "grok.com";
  label.parentElement = main;
  assert.equal(refresh(), false);
  assert.equal(clicks, 1);
});
