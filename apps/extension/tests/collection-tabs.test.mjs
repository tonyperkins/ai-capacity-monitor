import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const collectionTabs = source.match(/async function ensureCollectionTabs[\s\S]*?\n}\n\nasync function refreshTabs/)[0];
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsSource = await readFile(new URL("../options.js", import.meta.url), "utf8");
const popupSource = await readFile(new URL("../popup.js", import.meta.url), "utf8");

test("collection uses extension-owned pinned tabs instead of matching ordinary provider tabs", () => {
  assert.match(collectionTabs, /collectionTabIds/);
  assert.doesNotMatch(collectionTabs, /chrome\.tabs\.query/);
  assert.match(collectionTabs, /pinned: true/);
  assert.match(collectionTabs, /chrome\.storage\.local\.set\(\{ collectionTabIds: nextCollectionTabIds \}\)/);
});

test("providers with transient usage URLs navigate back before collection", () => {
  assert.match(source, /refreshTabs\(tabs, opened, targets\)/);
  assert.match(source, /collection\?\.navigateOnCollect/);
  assert.match(source, /chrome\.tabs\.update\(tab\.id, \{ url: targets\[index\]\.url \}\)/);
});

test("authenticated response readers run in the provider page and retain the DOM fallback", () => {
  const reader = source.match(/async function readProviderWithRetries[\s\S]*?\n}\n\nfunction sleep/)[0];
  assert.match(reader, /if \(target\.apiRead\)/);
  assert.match(reader, /world: "MAIN"/);
  assert.match(reader, /func: readProviderApiMetrics/);
  assert.match(reader, /func: readProviderMetrics/);
});

test("collection tabs are cleaned up when requested or when their provider is disabled", () => {
  assert.match(source, /if \(closeOpenedTabs\) await closeCollectionTabs\(tabs\.map\(\(tab\) => tab\.id\)\)/);
  assert.match(source, /async function pruneDisabledProviders/);
  assert.match(source, /await closeTabs\(staleTabIds\)/);
});

test("a provider-card refresh publishes the complete retained snapshot", () => {
  assert.match(source, /const snapshotMetrics = Object\.values\(nextByKey\)/);
  assert.match(source, /const snapshotDiagnostics = Object\.values\(nextStates\)/);
  assert.match(source, /metrics: snapshotMetrics, diagnostics: snapshotDiagnostics/);
  assert.doesNotMatch(source, /metrics: publishedMetrics/);
});

test("a default-off minimized collection window isolates automatic collection", () => {
  assert.match(optionsHtml, /id="collection-window"/);
  assert.match(optionsSource, /useCollectionWindow: \$\("collection-window"\)\.checked/);
  assert.match(source, /useCollectionWindow: false/);
  assert.match(source, /chrome\.windows\.create\(\{ url: initialUrl, state: "minimized", focused: false \}\)/);
  assert.match(collectionTabs, /await ensureCollectionWindow\(targets\[0\]\.url\)/);
  assert.doesNotMatch(collectionTabs, /focused:\s*true/);
});

test("sign-in actions open a foreground provider tab instead of the collection tab", () => {
  assert.match(source, /!collectionTabIdSet\.has\(tab\.id\)/);
  assert.match(source, /createProperties\.windowId = foregroundWindowId/);
  assert.match(popupSource, /chrome\.windows\.getCurrent\(\)/);
  assert.match(optionsSource, /Sign in to \$\{provider\.name\}/);
  assert.match(optionsSource, /chrome\.windows\.getCurrent\(\)/);
});
