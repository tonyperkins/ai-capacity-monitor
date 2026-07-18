import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const collectionTabs = source.match(/async function ensureCollectionTabs[\s\S]*?\n}\n\nasync function refreshTabs/)[0];

test("collection uses extension-owned pinned tabs instead of matching ordinary provider tabs", () => {
  assert.match(collectionTabs, /collectionTabIds/);
  assert.doesNotMatch(collectionTabs, /chrome\.tabs\.query/);
  assert.match(collectionTabs, /chrome\.tabs\.create\(\{ url: target\.url, active: false, pinned: true \}\)/);
  assert.match(collectionTabs, /chrome\.storage\.local\.set\(\{ collectionTabIds: nextCollectionTabIds \}\)/);
});

test("collection tabs are cleaned up when requested or when their provider is disabled", () => {
  assert.match(source, /if \(closeOpenedTabs\) await closeCollectionTabs\(tabs\.map\(\(tab\) => tab\.id\)\)/);
  assert.match(source, /async function pruneDisabledProviders/);
  assert.match(source, /await closeTabs\(staleTabIds\)/);
});
