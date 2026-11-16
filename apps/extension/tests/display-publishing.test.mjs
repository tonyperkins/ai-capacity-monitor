import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadProviders } from "./helpers.mjs";
import { validateSnapshot } from "../../local-bridge/snapshot.js";

const { PROVIDERS } = await loadProviders();
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const publishing = await readFile(new URL("../publishing.js", import.meta.url), "utf8");
const functions = background.slice(background.indexOf("function diagnosticMessage("), background.indexOf("async function ensureCollectionTabs("));
const provider = PROVIDERS.find((provider) => provider.metrics.some((metric) => metric.key === "claude-usage-cap"));

function harness(showClaudeMonthlySpendingCap) {
  const data = {
    publishMode: "bridge", bridgeUrl: "http://127.0.0.1:8787/collect",
    publishDisclosureKey: "bridge:http://127.0.0.1:8787/collect",
    showClaudeMonthlySpendingCap, enabledProviders: [provider.id],
    lastCollectedAt: "2026-10-15T12:00:00.000Z",
    latestMetrics: provider.metrics.map((metric) => ({ key: metric.key, provider: metric.provider, label: metric.label, kind: metric.kind, unit: metric.unit, value: 29, status: "verified" })),
    metricStates: Object.fromEntries(provider.metrics.map((metric) => [metric.key, { key: metric.key, providerId: provider.id, state: metric.key === "claude-usage-cap" ? "retained-prior" : "validated", attemptedAt: "2026-10-15T12:00:00.000Z", errorCode: null }])),
  };
  const sent = [];
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async (patch) => Object.assign(data, patch) } },
    alarms: { clear: async () => {}, create: () => {} },
    permissions: { contains: async () => true },
  };
  const api = new Function("PROVIDERS", "chrome", "fetch", "originPatternForUrl", `${publishing}\nlet activeDrain = null;\n${functions}\nreturn { publishCurrentSnapshot, publishSnapshot, drainPublishQueue };`)(
    PROVIDERS, chrome,
    async (_url, request) => { const snapshot = JSON.parse(request.body); assert.equal(validateSnapshot(snapshot).ok, true); sent.push(snapshot); return { ok: true, status: 202 }; },
    () => "http://127.0.0.1/*",
  );
  return { data, sent, ...api };
}

test("hidden cap is omitted from bridge snapshots and warnings while retained locally, and restored on show", async () => {
  const h = harness(false);
  await h.publishCurrentSnapshot();
  const hidden = h.sent[0];
  assert.ok(hidden.metrics.some((metric) => metric.key === "claude-usage-credit"));
  assert.ok(!hidden.metrics.some((metric) => metric.key === "claude-usage-cap"));
  assert.ok(!hidden.diagnostics.some((diagnostic) => diagnostic.key === "claude-usage-cap"));
  assert.deepEqual(hidden.issues, []);
  assert.ok(h.data.latestMetrics.some((metric) => metric.key === "claude-usage-cap"));
  assert.equal(hidden.collectedAt, h.data.lastCollectedAt);
  h.data.showClaudeMonthlySpendingCap = true;
  await h.publishCurrentSnapshot();
  assert.ok(h.sent[1].metrics.some((metric) => metric.key === "claude-usage-cap"));
  assert.equal(h.sent[1].issues.length, 1);
  assert.equal(h.sent[1].collectedAt, h.data.lastCollectedAt);
});

test("default keeps cap visible and queued retries honor the latest visibility setting", async () => {
  const h = harness(undefined);
  await h.publishCurrentSnapshot();
  assert.ok(h.sent[0].metrics.some((metric) => metric.key === "claude-usage-cap"));
  h.data.publishQueue = [h.sent[0]];
  h.data.showClaudeMonthlySpendingCap = false;
  await h.drainPublishQueue();
  assert.ok(!h.sent[1].metrics.some((metric) => metric.key === "claude-usage-cap"));
  assert.deepEqual(h.sent[1].issues, []);
});

test("saving display preferences does not publish when publishing is disabled or no reading exists", async () => {
  const h = harness(false);
  h.data.publishMode = "disabled";
  await h.publishCurrentSnapshot();
  assert.equal(h.sent.length, 0);
  h.data.publishMode = "bridge";
  delete h.data.lastCollectedAt;
  await h.publishCurrentSnapshot();
  assert.equal(h.sent.length, 0);
});
