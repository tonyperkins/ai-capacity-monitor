import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const permissionsSource = await readFile(new URL("../permissions.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(`${permissionsSource}; globalThis.originPatternForUrl = originPatternForUrl;`, sandbox);
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const packageScript = await readFile(new URL("../../../scripts/package-extension.py", import.meta.url), "utf8");

test("provider and destination URLs become Chrome origin match patterns", () => {
  assert.equal(sandbox.originPatternForUrl("https://app.kilo.ai/credits"), "https://app.kilo.ai/*");
  assert.equal(sandbox.originPatternForUrl("http://127.0.0.1:8787/collect"), "http://127.0.0.1/*");
  assert.equal(sandbox.originPatternForUrl("not a URL"), null);
});

test("provider hosts are optional and direct HTTPS publishing can request an exact origin", () => {
  assert.equal("host_permissions" in manifest, false);
  assert.ok(manifest.optional_host_permissions.includes("https://app.kilo.ai/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://grok.com/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(manifest.optional_host_permissions.includes("http://127.0.0.1/*"));
});

test("manifest and package include the Chrome toolbar icon sizes", () => {
  assert.deepEqual(manifest.icons, { "16": "assets/icon-16.png", "32": "assets/icon-32.png", "48": "assets/icon-48.png", "128": "assets/icon-128.png" });
  for (const icon of Object.values(manifest.icons)) assert.match(packageScript, new RegExp(`"${icon.replace(".", "\\.")}"`));
});
