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
vm.runInContext(`${formattingSource}; globalThis.formatMetric = formatMetric;`, sandbox);

test("metric values use the browser locale instead of provider display text", () => {
  assert.equal(sandbox.formatMetric({ value: 1234, unit: "usd", display: "$12.34" }, "de-DE"), "12,34 $");
  assert.equal(sandbox.formatMetric({ value: 45, unit: "percent", display: "45%" }, "de-DE"), "45 %");
  assert.equal(sandbox.formatMetric({ value: 1200, unit: "count" }, "de-DE"), "1.200");
  assert.equal(sandbox.formatMetric({ value: 100, unit: "percent", display: "Unlimited", availability: "unlimited" }, "de-DE"), "Unlimited");
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

test("popup footer prefers the completed collection timestamp over an older retained reading", () => {
  assert.match(popupSource, /collectedAt = data\.lastCollectedAt \?\? oldestVisibleCollectedAt\(visibleMetrics\) \?\? null/);
});
