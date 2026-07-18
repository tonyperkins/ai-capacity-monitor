import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../publishing.js", import.meta.url), "utf8");
const { validateDestinationUrl, computePublishBackoffMs, PUBLISH_QUEUE_LIMIT } = new Function(
  `${source}\nreturn { validateDestinationUrl, computePublishBackoffMs, PUBLISH_QUEUE_LIMIT };`,
)();

test("disabled mode needs no URL", () => {
  assert.equal(validateDestinationUrl("disabled", "").ok, true);
});

test("bridge accepts loopback and rejects everything else", () => {
  assert.equal(validateDestinationUrl("bridge", "http://127.0.0.1:8787/collect").ok, true);
  assert.equal(validateDestinationUrl("bridge", "http://localhost:9000/collect").ok, true);
  assert.equal(validateDestinationUrl("bridge", "http://192.168.1.10:8787/collect").ok, false);
  assert.equal(validateDestinationUrl("bridge", "https://example.com/collect").ok, false);
});

test("webhook requires HTTPS except toward loopback", () => {
  assert.equal(validateDestinationUrl("webhook", "https://example.com/capacity").ok, true);
  assert.equal(validateDestinationUrl("webhook", "http://127.0.0.1:9999/hook").ok, true);
  assert.equal(validateDestinationUrl("webhook", "http://example.com/capacity").ok, false);
});

test("invalid, empty, and non-http destinations are rejected with a message", () => {
  for (const raw of ["", "   ", "not a url", "ftp://example.com/x"]) {
    const result = validateDestinationUrl("webhook", raw);
    assert.equal(result.ok, false, raw);
    assert.ok(result.error, raw);
  }
});

test("backoff grows exponentially with jitter and caps at 30 minutes", () => {
  const atLow = (count) => computePublishBackoffMs(count, () => 0);
  const atHigh = (count) => computePublishBackoffMs(count, () => 1);
  assert.equal(atLow(1), 15000);
  assert.equal(atHigh(1), 30000);
  assert.equal(atLow(2), 30000);
  assert.equal(atHigh(2), 60000);
  assert.equal(atHigh(20), 30 * 60 * 1000, "cap at 30 minutes");
  assert.ok(atLow(20) >= 15 * 60 * 1000);
});

test("queue limit is bounded", () => {
  assert.ok(PUBLISH_QUEUE_LIMIT >= 1 && PUBLISH_QUEUE_LIMIT <= 50);
});
