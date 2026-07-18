import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../onboarding.js", import.meta.url), "utf8");
const html = await readFile(new URL("../onboarding.html", import.meta.url), "utf8");
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const packageScript = await readFile(new URL("../../../scripts/package-extension.py", import.meta.url), "utf8");

test("onboarding explains the boundary and requests provider access from its enable click", () => {
  assert.match(html, /onboarding\.js/);
  assert.match(source, /reads only the <strong>displayed balances and limits<\/strong>/);
  assert.match(source, /never asks for credentials/);
  assert.match(source, /chrome\.permissions\.request\(\{ origins: \[providerOrigin\(selectedProvider\)\] \}\)/);
  assert.match(source, /type: "collect-provider"/);
  assert.match(source, /onboardingCompleted: true/);
});

test("fresh installation opens onboarding and the package includes it", () => {
  assert.match(background, /details\?\.reason === "install"/);
  assert.match(background, /getURL\("onboarding\.html"\)/);
  assert.match(packageScript, /"onboarding\.html"/);
  assert.match(packageScript, /"onboarding\.css"/);
  assert.match(packageScript, /"onboarding\.js"/);
});
