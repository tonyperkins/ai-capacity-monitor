import assert from "node:assert/strict";
import test from "node:test";
import { collect } from "../collect.js";
import { validateSnapshot } from "../../local-bridge/snapshot.js";

const NOW = new Date("2026-11-16T01:00:00Z");
const source = (id, name, read) => ({ id, name, read });
const weekly = { id: "weekly", label: "Weekly limit", remaining: 66.4, resetAt: "2026-11-19T13:52:46.000Z", windowMs: 604800000 };

test("a snapshot from working sources satisfies the v1 contract", async () => {
  const snapshot = await collect({ now: NOW, sources: [
    source("a", "Alpha", async () => [weekly, { id: "scoped", label: "Weekly (Fable)", remaining: 83, parent: "weekly", group: "Models" }]),
  ] });
  assert.deepEqual(validateSnapshot(snapshot), { ok: true });
  assert.deepEqual(snapshot.metrics.map((metric) => [metric.key, metric.value, metric.display, metric.readState]), [["a/weekly", 66, "66%", "validated"], ["a/scoped", 83, "83%", "validated"]]);
  assert.equal(snapshot.metrics[1].parent, "a/weekly");
  assert.equal(snapshot.metrics[1].resetAt, undefined);
  assert.deepEqual(snapshot.issues, []);
  assert.deepEqual(snapshot.sources, { a: "validated" });
});

test("a limit the provider stops reporting disappears; a failed source keeps prior values", async () => {
  const first = await collect({ now: NOW, sources: [
    source("a", "Alpha", async () => [weekly, { id: "fable", label: "Weekly (Fable)", remaining: 83 }]),
    source("b", "Beta", async () => [{ id: "daily", label: "Daily quota", remaining: 95 }]),
  ] });
  const later = new Date("2026-11-16T01:10:00Z");
  const second = await collect({ now: later, previous: first, sources: [
    source("a", "Alpha", async () => [weekly]),
    source("b", "Beta", async () => { throw Object.assign(new Error("x"), { code: "timeout" }); }),
    source("c", "Gamma", async () => { throw new Error("no code"); }),
  ] });
  assert.deepEqual(validateSnapshot(second), { ok: true });
  assert.deepEqual(second.metrics.map((metric) => [metric.key, metric.readState, metric.status, metric.collectedAt]), [
    ["a/weekly", "validated", "verified", later.toISOString()],
    ["b/daily", "retained-prior", "unverified", NOW.toISOString()],
  ]);
  assert.deepEqual(second.issues, ["Beta: could not read this time (timeout); showing the last values.", "Gamma: no reading available (failed)."]);
  assert.deepEqual(second.sources, { a: "validated", b: "retained-prior", c: "failed" });
});

test("a disabled source is not read", async () => {
  let called = false;
  const snapshot = await collect({ now: NOW, enabled: { a: false }, sources: [source("a", "Alpha", async () => { called = true; return [weekly]; })] });
  assert.equal(called, false);
  assert.deepEqual(snapshot.metrics, []);
});
