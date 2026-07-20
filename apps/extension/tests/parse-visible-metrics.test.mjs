import assert from "node:assert/strict";
import test from "node:test";
import { FakeElement, loadProviders, setPage } from "./helpers.mjs";

const { PROVIDERS, inspectProviderPage, readProviderMetrics } = await loadProviders();

// Runs the engine across every registered provider spec, mirroring the old
// single-function behavior: only the spec matching the current hostname
// produces metrics.
const parse = () => PROVIDERS.flatMap((provider) => readProviderMetrics({ hostname: provider.hostname, metrics: provider.metrics }));

function byKey(results) {
  return Object.fromEntries(results.map((metric) => [metric.key, metric]));
}

test("registry is structurally sound", () => {
  const keys = PROVIDERS.flatMap((provider) => provider.metrics.map((metric) => metric.key));
  assert.equal(new Set(keys).size, keys.length, "metric keys must be unique across providers");
  const hostnames = PROVIDERS.map((provider) => provider.hostname);
  assert.equal(new Set(hostnames).size, hostnames.length, "hostnames must be unique across providers");
  for (const provider of PROVIDERS) {
    assert.ok(provider.id && provider.name && provider.hostname && provider.url && provider.match, `${provider.id ?? "?"}: id/name/hostname/url/match required`);
    assert.ok(provider.collection?.readyTimeoutMs > 0 && provider.collection?.maxAttempts > 0 && provider.collection?.retryDelayMs > 0, `${provider.id}: collection policy required`);
    assert.ok(provider.metrics.length > 0, `${provider.id}: at least one metric`);
    for (const metric of provider.metrics) {
      assert.ok(metric.key && metric.provider && metric.label, `${metric.key ?? "?"}: key/provider/label required`);
      assert.ok(["credit", "quota"].includes(metric.kind), `${metric.key}: valid kind`);
      assert.ok(["usd", "percent", "count"].includes(metric.unit), `${metric.key}: valid unit`);
      assert.ok(metric.read?.type, `${metric.key}: read spec required`);
      if (metric.kind === "quota") assert.ok(metric.resetWindowMs > 0, `${metric.key}: quotas need a resetWindowMs`);
      const moneyReads = ["money-after", "money-before-or-after", "labeled-card-money"];
      if (moneyReads.includes(metric.read.type)) assert.equal(metric.unit, "usd", `${metric.key}: money reads must be unit usd`);
      if (metric.read.type === "count-after") assert.equal(metric.unit, "count", `${metric.key}: counted reads must be unit count, never usd`);
      if (["quota", "unlimited-or-quota"].includes(metric.read.type)) assert.equal(metric.unit, "percent", `${metric.key}: quota reads must be unit percent`);
    }
  }
});

test("login pages are classified without exposing page text", () => {
  const provider = PROVIDERS.find((candidate) => candidate.id === "openai-platform");
  setPage({
    hostname: "platform.openai.com",
    href: "https://platform.openai.com/login",
    text: "Welcome back\nLog in to continue",
  });
  assert.deepEqual(inspectProviderPage(provider), { state: "unauthenticated", errorCode: "sign-in-required" });
});

test("an authenticated provider page is ready for parsing", () => {
  const provider = PROVIDERS.find((candidate) => candidate.id === "openai-platform");
  setPage({ hostname: "platform.openai.com", text: "Usage\nCredit balance\n$6.89" });
  assert.deepEqual(inspectProviderPage(provider), { state: "ready", errorCode: null });
});

test("OpenAI API credit balance", () => {
  setPage({
    hostname: "platform.openai.com",
    text: "Usage\nCredit balance\n$6.89\nAdd to balance",
  });
  const { "openai-api-credit": metric } = byKey(parse());
  assert.equal(metric.value, 689);
  assert.equal(metric.display, "$6.89");
  assert.equal(metric.kind, "credit");
});

test("Claude API organization credit balance", () => {
  setPage({
    hostname: "platform.claude.com",
    text: "Billing\nOrganization credits\n$3.64 remaining this period",
  });
  const { "claude-api-credit": metric } = byKey(parse());
  assert.equal(metric.value, 364);
  assert.equal(metric.display, "$3.64");
});

test("negative (parenthesized) currency values are preserved", () => {
  setPage({
    hostname: "platform.openai.com",
    text: "Usage\nCredit balance\n($4.20)\nYour account is past due",
  });
  const { "openai-api-credit": metric } = byKey(parse());
  assert.equal(metric.value, -420);
  assert.equal(metric.display, "-$4.20");
});

test("Kilo balance via the DOM card-lookup path", () => {
  const label = new FakeElement({ textContent: "Remaining Credits" });
  const row = new FakeElement({ children: [label] });
  const card = new FakeElement({ children: [row], innerText: "Remaining Credits\n$3.05" });
  setPage({ hostname: "app.kilo.ai", text: "Remaining Credits\n$3.05", dom: card });
  const { "kilo-credit": metric } = byKey(parse());
  assert.equal(metric.value, 305);
  assert.equal(metric.display, "$3.05");
  assert.equal(metric.unit, "usd");
});

test("Kilo balance falls through label variants via the text fallback when no DOM card matches", () => {
  // No "Remaining Credits" or "Available Credits" anywhere in the text —
  // only the third label variant, "Credit Balance", is present.
  setPage({
    hostname: "app.kilo.ai",
    text: "Account\nCredit Balance\n$1.50\nUsage this month",
  });
  const { "kilo-credit": metric } = byKey(parse());
  assert.equal(metric.value, 150);
  assert.equal(metric.display, "$1.50");
});

test("Kilo balance recognizes the current credits-page label", () => {
  setPage({ hostname: "app.kilo.ai", text: "Credits\nYour credit balance\n$2.78\navailable" });
  const { "kilo-credit": metric } = byKey(parse());
  assert.equal(metric.value, 278);
  assert.equal(metric.display, "$2.78");
});

test("Kilo balance is omitted (not fabricated as $0) when no label has a nearby value", () => {
  setPage({
    hostname: "app.kilo.ai",
    text: "Remaining Credits\nYour account is not eligible for a balance display at this time.",
  });
  const results = byKey(parse());
  assert.equal(results["kilo-credit"], undefined);
});

test("ChatGPT weekly quota with 'remaining' phrasing, plus reset text", () => {
  setPage({
    hostname: "chatgpt.com",
    text: "Weekly usage limit\n38% remaining\nResets Jul 23, 2026 5:47 PM",
  });
  const { "chatgpt-weekly": metric } = byKey(parse());
  assert.equal(metric.value, 38);
  assert.equal(metric.display, "38%");
  assert.equal(metric.resetText, "Resets Jul 23, 2026 5:47 PM");
});

test("Claude quotas: 'used' phrasing is inverted to percent remaining", () => {
  setPage({
    hostname: "claude.ai",
    text: "Current session\n7% used\nResets in 3 hr 52 min",
  });
  const { "claude-session": metric } = byKey(parse());
  assert.equal(metric.value, 93);
  assert.equal(metric.display, "93%");
  assert.equal(metric.resetText, "Resets in 3 hr 52 min");
});

test("Claude quotas: 'remaining' phrasing is used as-is", () => {
  setPage({
    hostname: "claude.ai",
    text: "All models\n88% remaining\nResets in 16 hr 52 min",
  });
  const { "claude-weekly": metric } = byKey(parse());
  assert.equal(metric.value, 88);
  assert.equal(metric.display, "88%");
});

test("Claude current usage page omits the retired Fable metric", () => {
  setPage({
    hostname: "claude.ai",
    text: [
      "Current session",
      "7% used",
      "Resets in 3 hr 52 min",
      "All models",
      "88% remaining",
      "Resets in 16 hr 52 min",
      "$10.93",
      "Current balance",
      "Usage credits",
      "71% used",
      "Resets Aug 1",
    ].join("\n"),
  });
  const results = byKey(parse());
  assert.equal(results["claude-session"].value, 93);
  assert.equal(results["claude-weekly"].value, 88);
  assert.equal(results["claude-fable"], undefined);
  assert.equal(results["claude-usage-credit"].value, 1093);
  assert.equal(results["claude-usage-credit"].display, "$10.93");
  assert.equal(results["claude-usage-cap"].value, 29);
  assert.equal(results["claude-usage-cap"].resetText, "Resets Aug 1");
});

test("Claude usage credits reports an unlimited monthly spend limit without retaining a stale zero-percent cap", () => {
  setPage({
    hostname: "claude.ai",
    text: [
      "Usage credits",
      "$56.65 spent",
      "Resets Aug 1",
      "Unlimited",
      "Monthly spend limit",
      "$95.24",
      "Current balance",
    ].join("\n"),
  });
  const { "claude-usage-cap": metric } = byKey(parse());
  assert.equal(metric.display, "Unlimited");
  assert.equal(metric.availability, "unlimited");
  assert.equal(metric.resetText, "Resets Aug 1");
});

test("a metric for an unrelated hostname is never produced", () => {
  setPage({ hostname: "example.com", text: "Credit balance $9.99" });
  assert.deepEqual(parse(), []);
});

test("xAI console credit balance", () => {
  // Real text captured from console.x.ai's landing page.
  setPage({
    hostname: "console.x.ai",
    text: "Welcome, Tony\nCreate API key\n\nEnable auto top up\n\nNever run out of credits\n\nEnable\nUsage\n24h\n7d\n30d\n90d\n\nSee all\n\nCredits remaining\n\n$10.00\n\nAdd\n\nCredits usage\n\n$0.00\n\nTokens\n\nRequests",
  });
  const { "xai-credit": metric } = byKey(parse());
  assert.equal(metric.value, 1000);
  assert.equal(metric.display, "$10.00");
});

test("Gemini Pro usage limits (current usage and weekly, both 'used' phrasing)", () => {
  // Real text captured from gemini.google.com/usage.
  setPage({
    hostname: "gemini.google.com",
    text: "Gemini\nUsage limits\nPRO\n\nYour plan's limits determine how much you can use Gemini over time. Advanced models and features can take up more usage. Learn more\n\nUpdated 1 min ago\n\nCurrent usage\n\n0% used\n\nResets at 10:59 PM\n\nWeekly limit\n\nResets Jul 21 at 1:59 PM\n\n1% used\n\nGet 5x more usage with AI Ultra\n\n$99.99/month\n\nUpgrade",
  });
  const results = byKey(parse());
  assert.equal(results["gemini-current-usage"].value, 100);
  assert.equal(results["gemini-current-usage"].resetText, "Resets at 10:59 PM");
  assert.equal(results["gemini-weekly"].value, 99);
  assert.equal(results["gemini-weekly"].resetText, "Resets Jul 21 at 1:59 PM");
});

test("Google One AI credits (a bare count, not a dollar balance)", () => {
  // Real text captured from one.google.com/ai/activity. Note "AI credits"
  // appears several times in surrounding prose before the actual label+value
  // pair — this locks in that the parser still lands on the right number.
  setPage({
    hostname: "one.google.com",
    text: "One\n\t\nSettings\nAI credits activity\nAI credits let you keep using AI models and features when you hit a plan usage limit.\nLearn more about how AI credits work\nAI credits\n2,228\nadd\nAdd\ninfo\nAI credits included with your plan have been replaced by product-based usage limits\nLearn more\nYour recent activity",
  });
  const { "google-ai-credit": metric } = byKey(parse());
  assert.equal(metric.value, 2228);
  assert.equal(metric.display, "2,228 credits");
  assert.equal(metric.kind, "credit");
  assert.equal(metric.unit, "count", "a credit count must never be published as usd cents");
});
