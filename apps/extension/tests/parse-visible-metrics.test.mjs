import assert from "node:assert/strict";
import test from "node:test";
import { FakeElement, loadParseVisibleMetrics, setPage } from "./helpers.mjs";

const parseVisibleMetrics = await loadParseVisibleMetrics();

function byKey(results) {
  return Object.fromEntries(results.map((metric) => [metric.key, metric]));
}

test("OpenAI API credit balance", () => {
  setPage({
    hostname: "platform.openai.com",
    text: "Usage\nCredit balance\n$6.89\nAdd to balance",
  });
  const { "openai-api-credit": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 689);
  assert.equal(metric.display, "$6.89");
  assert.equal(metric.kind, "credit");
});

test("Claude API organization credit balance", () => {
  setPage({
    hostname: "platform.claude.com",
    text: "Billing\nOrganization credits\n$3.64 remaining this period",
  });
  const { "claude-api-credit": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 364);
  assert.equal(metric.display, "$3.64");
});

test("negative (parenthesized) currency values are preserved", () => {
  setPage({
    hostname: "platform.openai.com",
    text: "Usage\nCredit balance\n($4.20)\nYour account is past due",
  });
  const { "openai-api-credit": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, -420);
  assert.equal(metric.display, "-$4.20");
});

test("Kilo balance via the DOM card-lookup path", () => {
  const label = new FakeElement({ textContent: "Remaining Credits" });
  const row = new FakeElement({ children: [label] });
  const card = new FakeElement({ children: [row], innerText: "Remaining Credits\n$3.05" });
  setPage({ hostname: "app.kilo.ai", text: "Remaining Credits\n$3.05", dom: card });
  const { "kilo-credit": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 305);
  assert.equal(metric.display, "$3.05");
});

test("Kilo balance falls through label variants via the text fallback when no DOM card matches", () => {
  // No "Remaining Credits" or "Available Credits" anywhere in the text —
  // only the third label variant, "Credit Balance", is present.
  setPage({
    hostname: "app.kilo.ai",
    text: "Account\nCredit Balance\n$1.50\nUsage this month",
  });
  const { "kilo-credit": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 150);
  assert.equal(metric.display, "$1.50");
});

test("Kilo balance is omitted (not fabricated as $0) when no label has a nearby value", () => {
  setPage({
    hostname: "app.kilo.ai",
    text: "Remaining Credits\nYour account is not eligible for a balance display at this time.",
  });
  const results = byKey(parseVisibleMetrics());
  assert.equal(results["kilo-credit"], undefined);
});

test("ChatGPT weekly quota with 'remaining' phrasing, plus reset text", () => {
  setPage({
    hostname: "chatgpt.com",
    text: "Weekly usage limit\n38% remaining\nResets Jul 23, 2026 5:47 PM",
  });
  const { "chatgpt-weekly": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 38);
  assert.equal(metric.display, "38%");
  assert.equal(metric.resetText, "Resets Jul 23, 2026 5:47 PM");
});

test("Claude quotas: 'used' phrasing is inverted to percent remaining", () => {
  setPage({
    hostname: "claude.ai",
    text: "Current session\n7% used\nResets in 3 hr 52 min",
  });
  const { "claude-session": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 93);
  assert.equal(metric.display, "93%");
  assert.equal(metric.resetText, "Resets in 3 hr 52 min");
});

test("Claude quotas: 'remaining' phrasing is used as-is", () => {
  setPage({
    hostname: "claude.ai",
    text: "All models\n88% remaining\nResets in 16 hr 52 min",
  });
  const { "claude-weekly": metric } = byKey(parseVisibleMetrics());
  assert.equal(metric.value, 88);
  assert.equal(metric.display, "88%");
});

test("Claude usage-credit balance and monthly spending cap on a full settings page", () => {
  setPage({
    hostname: "claude.ai",
    text: [
      "Current session",
      "7% used",
      "Resets in 3 hr 52 min",
      "All models",
      "88% remaining",
      "Resets in 16 hr 52 min",
      "Fable",
      "88% remaining",
      "Resets in 16 hr 52 min",
      "$10.93",
      "Current balance",
      "Usage credits",
      "71% used",
      "Resets Aug 1",
    ].join("\n"),
  });
  const results = byKey(parseVisibleMetrics());
  assert.equal(results["claude-session"].value, 93);
  assert.equal(results["claude-weekly"].value, 88);
  assert.equal(results["claude-fable"].value, 88);
  assert.equal(results["claude-usage-credit"].value, 1093);
  assert.equal(results["claude-usage-credit"].display, "$10.93");
  assert.equal(results["claude-usage-cap"].value, 29);
  assert.equal(results["claude-usage-cap"].resetText, "Resets Aug 1");
});

test("a metric for an unrelated hostname is never produced", () => {
  setPage({ hostname: "example.com", text: "Credit balance $9.99" });
  assert.deepEqual(parseVisibleMetrics(), []);
});
