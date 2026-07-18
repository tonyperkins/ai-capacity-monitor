import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsSource = await readFile(new URL("../options.js", import.meta.url), "utf8");
const onboardingHtml = await readFile(new URL("../onboarding.html", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");
const privacyPolicy = await readFile(new URL("../../../docs/privacy-policy.md", import.meta.url), "utf8");
const permissionDraft = await readFile(new URL("../../../docs/web-store-permissions.md", import.meta.url), "utf8");

test("privacy policy and Store permission draft are present and linked in-product", () => {
  assert.match(privacyPolicy, /What the extension reads/);
  assert.match(privacyPolicy, /When data leaves this device/);
  assert.match(privacyPolicy, /Delete all local data/);
  assert.match(permissionDraft, /`scripting`/);
  assert.match(optionsHtml, /docs\/privacy-policy\.md/);
  assert.match(onboardingHtml, /docs\/privacy-policy\.md/);
});

test("publishing requires acknowledgement and saved secrets are not rendered", () => {
  assert.match(optionsHtml, /id="publish-ack"/);
  assert.match(optionsSource, /Review and acknowledge the publishing disclosure/);
  assert.match(optionsSource, /Saved — enter a new value to replace/);
  assert.match(optionsSource, /publishDisclosureKey/);
  assert.match(backgroundSource, /publishing disclosure needs acknowledgement in Settings/);
});

test("delete-local-data clears local storage and collection alarms", () => {
  assert.match(optionsHtml, /id="delete-local-data"/);
  assert.match(optionsSource, /type: "delete-local-data"/);
  assert.match(backgroundSource, /chrome\.storage\.local\.clear\(\)/);
  assert.match(backgroundSource, /chrome\.alarms\.clear\("collect"\)/);
  assert.match(backgroundSource, /chrome\.alarms\.clear\("publish-retry"\)/);
  assert.match(backgroundSource, /every\(\(change\) => change\.newValue === undefined\)/);
});
