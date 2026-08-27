import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const formattingSource = await readFile(new URL("../formatting.js", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const popupSource = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const packageScript = await readFile(new URL("../../../scripts/package-extension.py", import.meta.url), "utf8");
const sandbox = { Intl, Date };
vm.createContext(sandbox);
vm.runInContext(`${formattingSource}; globalThis.formatMetric = formatMetric; globalThis.timeRemainingPercent = timeRemainingPercent;`, sandbox);

test("metric values use the browser locale instead of provider display text", () => {
  assert.equal(sandbox.formatMetric({ value: 1234, unit: "usd", display: "$12.34" }, "de-DE"), "12,34 $");
  assert.equal(sandbox.formatMetric({ value: 45, unit: "percent", display: "45%" }, "de-DE"), "45 %");
  assert.equal(sandbox.formatMetric({ value: 1200, unit: "count" }, "de-DE"), "1.200");
  assert.equal(sandbox.formatMetric({ value: 100, unit: "percent", display: "Unlimited", availability: "unlimited" }, "de-DE"), "Unlimited");
});

test("weekday reset timestamps produce a time-remaining percentage", () => {
  const now = new Date(2026, 6, 22, 12, 0, 0); // Wednesday, July 22, 2026 at noon.
  const percent = sandbox.timeRemainingPercent({ resetText: "Resets Sat 11:00 AM" }, 7 * 24 * 60 * 60 * 1000, now);
  assert.ok(percent > 42 && percent < 43);
});

test("popup exposes semantic regions, card labels, and meter values", () => {
  assert.match(popupHtml, /aria-label="Credit balances"/);
  assert.match(popupHtml, /aria-live="polite"/);
  assert.match(popupSource, /role="progressbar"/);
  assert.match(popupSource, /aria-valuetext/);
  assert.match(popupSource, /aria-label="\$\{escapeHtml\(accessibleName\)\}"/);
  assert.match(popupCss, /button:focus-visible, input:focus-visible/);
  assert.match(packageScript, /"formatting\.js"/);
  assert.match(packageScript, /"strings\.js"/);
});

test("popup width remains stable when its vertical scrollbar appears", () => {
  assert.match(popupCss, /:root\s*\{[^}]*width:\s*420px[^}]*scrollbar-gutter:\s*stable[^}]*overflow-y:\s*scroll/s);
  assert.match(popupCss, /body\s*\{[^}]*width:\s*420px/s);
  assert.doesNotMatch(popupCss, /width:\s*min\([^;]*100vw/);
});

test("popup footer prefers the completed collection timestamp over an older retained reading", () => {
  assert.match(popupSource, /collectedAt = data\.lastCollectedAt \?\? oldestVisibleCollectedAt\(visibleMetrics\) \?\? null/);
});
