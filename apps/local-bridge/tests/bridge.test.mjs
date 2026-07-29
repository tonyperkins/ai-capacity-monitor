import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBridge, normalizeConfig } from "../bridge.js";

const secret = "test-secret";
const snapshot = {
  version: "1",
  collectedAt: "2026-07-18T12:00:00.000Z",
  metrics: [{ key: "openai-api-credit", provider: "OpenAI API Balance", label: "Prepaid API credit", kind: "credit", value: 689, unit: "usd", status: "verified", readState: "validated", collectedAt: "2026-07-18T12:00:00.000Z" }],
  diagnostics: [{ key: "openai-api-credit", providerId: "openai-platform", state: "validated", attemptedAt: "2026-07-18T12:00:00.000Z", errorCode: null }],
  issues: [],
};

async function withBridge({ fetchImpl, callback, config: configOverrides = {} }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capacity-bridge-test-"));
  const config = {
    collectorSecret: secret,
    destination: { type: "webhook", url: "http://127.0.0.1:9999/collect", headers: { authorization: "Bearer test" } },
    queuePath: path.join(directory, "queue.json"),
    queueLimit: 5,
    ...configOverrides,
    ...(configOverrides.display ? { display: { ...configOverrides.display, snapshotPath: path.join(directory, "latest-snapshot.json") } } : {}),
  };
  const bridge = await createBridge({ config, fetchImpl });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const port = bridge.server.address().port;
  if (bridge.displayServer) await new Promise((resolve) => bridge.displayServer.listen(0, "127.0.0.1", resolve));
  const displayUrl = bridge.displayServer ? `http://127.0.0.1:${bridge.displayServer.address().port}` : null;
  try { await callback({ bridge, url: `http://127.0.0.1:${port}`, displayUrl }); }
  finally {
    bridge.close();
    if (bridge.displayServer) await new Promise((resolve) => bridge.displayServer.close(resolve));
    await new Promise((resolve) => bridge.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

async function collect(url, body, requestSecret = secret) {
  return fetch(`${url}/collect`, { method: "POST", headers: { "content-type": "application/json", "x-collector-secret": requestSecret }, body: JSON.stringify(body) });
}

test("rejects invalid snapshots before forwarding", async () => {
  let forwarded = 0;
  await withBridge({
    fetchImpl: async () => { forwarded += 1; return new Response(null, { status: 202 }); },
    callback: async ({ url }) => {
      const response = await collect(url, { version: "1" });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid-snapshot-header" });
      assert.equal(forwarded, 0);
    },
  });
});

test("forwards a validated snapshot to a generic webhook", async () => {
  const received = [];
  await withBridge({
    fetchImpl: async (url, init) => { received.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(null, { status: 202 }); },
    callback: async ({ url }) => {
      const response = await collect(url, snapshot);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: 1, queued: 0 });
      assert.equal(received.length, 1);
      assert.equal(received[0].headers.authorization, "Bearer test");
      assert.deepEqual(received[0].body, snapshot);
    },
  });
});

test("retains an undelivered snapshot and retries it after recovery", async () => {
  let available = false;
  let delivered = 0;
  await withBridge({
    fetchImpl: async () => {
      if (!available) throw new Error("offline");
      delivered += 1;
      return new Response(null, { status: 204 });
    },
    callback: async ({ bridge, url }) => {
      const response = await collect(url, snapshot);
      assert.equal(response.status, 202);
      assert.equal(bridge.health().queueSize, 1);
      assert.equal(bridge.health().lastDelivery.state, "delayed");
      available = true;
      await bridge.drain({ force: true });
      assert.equal(delivered, 1);
      assert.equal(bridge.health().queueSize, 0);
      assert.equal(bridge.health().lastDelivery.state, "delivered");
    },
  });
});

test("health is redacted and legacy Sites settings migrate to a generic destination", async () => {
  const config = normalizeConfig({ collectorSecret: secret, siteUrl: "https://example.com", token: "top-secret", sitesBypassToken: "also-secret" }, { configPath: "/tmp/capacity/collector.json" });
  assert.equal(config.destination.type, "webhook");
  assert.equal(config.destination.url, "https://example.com/api/ingest");
  await withBridge({
    fetchImpl: async () => new Response(null, { status: 204 }),
    callback: async ({ url }) => {
      const response = await fetch(`${url}/health`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.doesNotMatch(body, /test-secret|\$6\.89|Bearer test/);
      assert.match(body, /queueSize/);
    },
  });
});

test("serves the latest validated snapshot from a token-protected read-only endpoint", async () => {
  await withBridge({
    config: { destination: null, display: { enabled: true, token: "display-secret" } },
    callback: async ({ bridge, url, displayUrl }) => {
      const before = await fetch(`${displayUrl}/snapshot/v1`, { headers: { authorization: "Bearer display-secret" } });
      assert.equal(before.status, 503);

      const response = await collect(url, snapshot);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: 1, queued: 0 });
      assert.equal(bridge.health().snapshotAvailable, true);

      const unauthorized = await fetch(`${displayUrl}/snapshot/v1`);
      assert.equal(unauthorized.status, 401);
      const displayed = await fetch(`${displayUrl}/snapshot/v1`, { headers: { authorization: "Bearer display-secret" } });
      assert.equal(displayed.status, 200);
      assert.deepEqual(await displayed.json(), snapshot);
      const writeAttempt = await fetch(`${displayUrl}/snapshot/v1`, { method: "POST", headers: { authorization: "Bearer display-secret" } });
      assert.equal(writeAttempt.status, 404);
    },
  });
});

test("normalizes a display-only bridge configuration", () => {
  const config = normalizeConfig({ collectorSecret: secret, display: { enabled: true, token: "display-secret" } }, { configPath: "/tmp/capacity/collector.json" });
  assert.equal(config.destination, null);
  assert.equal(config.display.host, "0.0.0.0");
  assert.equal(config.display.port, 8788);
  assert.equal(config.display.snapshotPath, "/tmp/capacity/latest-snapshot.json");
});
