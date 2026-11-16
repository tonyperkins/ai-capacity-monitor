import assert from "node:assert/strict";
import test from "node:test";
import { FakeElement, loadProviders, setPage } from "./helpers.mjs";

const { PROVIDERS, inspectProviderPage, readProviderApiMetrics, readProviderMetrics } = await loadProviders();

// Runs the engine across every registered provider spec, mirroring the old
// single-function behavior: only the spec matching the current hostname
// produces metrics.
const parse = () => PROVIDERS.flatMap((provider) => readProviderMetrics({ hostname: provider.hostname, metrics: provider.metrics }));

function byKey(results) {
  return Object.fromEntries(results.map((metric) => [metric.key, metric]));
}

test("Grok spending-only overview never mistakes monthly spending for a credit balance", () => {
  for (const spending of ["$0.00", "$37.42"]) {
    const meter = new FakeElement({ attributes: { role: "meter", "aria-label": "Weekly included usage", "aria-valuetext": "34% used" } });
    setPage({ hostname: "grok.com", dom: meter, text: `Premium\n34% used\nWeekly included usage\nResets Nov 11\nAccount balance\n${spending} used this month\nMonthly additional usage\nMonthly additional usage limit\nNot set · Edit\nBuy credits` });
    const metrics = byKey(parse());
    assert.equal(metrics["grok-weekly"].value, 66);
    assert.deepEqual(metrics["grok-extra-credit"], { key: "grok-extra-credit", availability: "not-applicable" });
  }
});

test("Grok does not hide credits on an incomplete overview or an unreadable labeled card", () => {
  for (const text of [
    "Weekly included usage\n34% used\nAccount balance\nLoading",
    "Weekly included usage\n34% used\nAccount balance\nMonthly additional usage\nMonthly additional usage limit\nCredits available\nLoading",
    "Account balance\nMonthly additional usage\nMonthly additional usage limit\nLoading weekly usage",
  ]) {
    setPage({ hostname: "grok.com", text });
    assert.equal(byKey(parse())["grok-extra-credit"], undefined);
  }
});

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
      if (metric.read.maxAncestorDepth !== undefined) assert.ok(Number.isInteger(metric.read.maxAncestorDepth) && metric.read.maxAncestorDepth > 0, `${metric.key}: maxAncestorDepth must be a positive integer`);
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

test("Claude API remaining balance on the billing page", () => {
  setPage({
    hostname: "platform.claude.com",
    href: "https://platform.claude.com/settings/billing",
    text: "Billing\nCredit balance\nYour credit balance will be consumed with API, Claude Code and playground usage.\n$2.66\nRemaining balance\nSpend limits\n$0.98 spent\nInvoice history\nJul 16, 2026\tCredit grant\t$6.40",
  });
  const { "claude-api-credit": metric } = byKey(parse());
  assert.equal(metric.value, 266);
  assert.equal(metric.display, "$2.66");
  assert.equal(metric.label, "Remaining balance");
});

test("Claude API balance reads its authenticated credits response without waiting for hidden-tab rendering", async () => {
  const provider = PROVIDERS.find((candidate) => candidate.id === "claude-platform");
  assert.equal(provider.url, "https://platform.claude.com/settings/billing");
  assert.deepEqual(provider.apiRead, { type: "claude-prepaid-credits", metricKey: "claude-api-credit" });
  globalThis.location = { hostname: "platform.claude.com" };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, "include");
    if (url === "/api/organizations") return {
      ok: true,
      json: async () => [
        { uuid: "11111111-1111-4111-8111-111111111111", billing_type: "stripe_subscription" },
        { uuid: "e0468b47-925e-45f3-9113-67126f9fa059", billing_type: "prepaid" },
      ],
    };
    assert.equal(url, "/api/organizations/e0468b47-925e-45f3-9113-67126f9fa059/prepaid/credits");
    return {
      ok: true,
      json: async () => ({ currency: "USD", balance: { credits: { amount_minor: 266, exponent: 2 } } }),
    };
  };
  const [metric] = await readProviderApiMetrics(provider);
  assert.deepEqual(metric, {
    key: "claude-api-credit",
    provider: "Claude API Balance",
    label: "Remaining balance",
    kind: "credit",
    unit: "usd",
    value: 266,
    display: "$2.66",
  });
});

test("Claude API response reader rejects malformed money and leaves the DOM fallback available", async () => {
  const provider = PROVIDERS.find((candidate) => candidate.id === "claude-platform");
  globalThis.location = { hostname: "platform.claude.com" };
  globalThis.fetch = async (url) => url === "/api/organizations"
    ? { ok: true, json: async () => [{ uuid: "e0468b47-925e-45f3-9113-67126f9fa059", billing_type: "prepaid" }] }
    : { ok: true, json: async () => ({ currency: "USD", balance: { credits: { amount_minor: 2.66, exponent: 2 } } }) };
  assert.deepEqual(await readProviderApiMetrics(provider), []);
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

test("currency readings are normalized to integer cents", () => {
  setPage({ hostname: "app.kilo.ai", text: "Credits\nYour credit balance\n$5.10\navailable" });
  const { "kilo-credit": metric } = byKey(parse());
  assert.equal(metric.value, 510);
  assert.equal(Number.isInteger(metric.value), true);
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

test("ChatGPT subscription limits expose 5-hour and weekly windows", () => {
  setPage({
    hostname: "chatgpt.com",
    text: "Plan limits\n5-hour limit\nResets in 3h 5m\n0% left\nWeekly limit\nResets in 5d 20h\n81% left",
  });
  const results = byKey(parse());
  assert.equal(results["chatgpt-session"].value, 0);
  assert.equal(results["chatgpt-session"].display, "0%");
  assert.equal(results["chatgpt-session"].resetText, "Resets in 3h 5m");
  assert.equal(results["chatgpt-weekly"].value, 81);
  assert.equal(results["chatgpt-weekly"].display, "81%");
  assert.equal(results["chatgpt-weekly"].resetText, "Resets in 5d 20h");
});

test("ChatGPT weekly quota accepts the legacy usage label", () => {
  setPage({
    hostname: "chatgpt.com",
    text: "Weekly usage limit\n38% remaining\nResets Jul 23, 2026 5:47 PM",
  });
  const { "chatgpt-weekly": metric } = byKey(parse());
  assert.equal(metric.value, 38);
  assert.equal(metric.resetText, "Resets Jul 23, 2026 5:47 PM");
});

test("ChatGPT weekly-only limits explicitly retire the five-hour window", () => {
  setPage({ hostname: "chatgpt.com", text: "Plan limits\nWeekly limit\nResets in 5d 20h\n81% left" });
  const results = byKey(parse());
  assert.deepEqual(results["chatgpt-session"], { key: "chatgpt-session", availability: "not-applicable" });
  assert.equal(results["chatgpt-weekly"].value, 81);
});

test("ChatGPT loading pages and unreadable five-hour values do not retire the window", () => {
  for (const text of ["Loading", "Weekly limit\nLoading", "5-hour limit\nLoading\nWeekly limit\n81% left"]) {
    setPage({ hostname: "chatgpt.com", text });
    assert.equal(byKey(parse())["chatgpt-session"], undefined);
  }
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

test("Claude idle session does not borrow the weekly reset", () => {
  setPage({
    hostname: "claude.ai",
    text: [
      "Current session",
      "Starts when a message is sent",
      "0% used",
      "Weekly limits",
      "All models",
      "Resets Sat 10:59 AM",
      "17% used",
    ].join("\n"),
  });
  const results = byKey(parse());
  assert.equal(results["claude-session"].value, 100);
  assert.equal(results["claude-session"].resetText, undefined);
  assert.equal(results["claude-weekly"].value, 83);
  assert.equal(results["claude-weekly"].resetText, "Resets Sat 10:59 AM");
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
  // Responsive card layout can flatten Credits usage/$0.23 ahead of the
  // remaining balance even though the displayed card shows $9.79.
  const remainingLabel = new FakeElement({ textContent: "Credits remaining" });
  const remainingAmount = new FakeElement({ textContent: "$9.79" });
  const remainingCard = new FakeElement({ children: [remainingLabel, remainingAmount] });
  const usageCard = new FakeElement({ children: [
    new FakeElement({ textContent: "Credits usage" }),
    new FakeElement({ textContent: "$0.23" }),
  ] });
  setPage({
    hostname: "console.x.ai",
    text: "Welcome, Tony\nUsage\n30d\nCredits remaining\nCredits usage\n$0.23\n$9.79\nTokens\n82,537",
    dom: new FakeElement({ children: [remainingCard, usageCard] }),
  });
  const { "xai-credit": metric } = byKey(parse());
  assert.equal(metric.value, 979);
  assert.equal(metric.display, "$9.79");
});

test("xAI omits a partial render instead of mistaking usage for balance", () => {
  const remainingLabel = new FakeElement({ textContent: "Credits remaining" });
  const remainingGroup = new FakeElement({ children: [remainingLabel] });
  const balanceControls = new FakeElement({ children: [remainingGroup, new FakeElement({ textContent: "Add" })] });
  const usageGroup = new FakeElement({ children: [
    new FakeElement({ textContent: "Credits usage" }),
    new FakeElement({ textContent: "$0.23" }),
  ] });
  setPage({
    hostname: "console.x.ai",
    text: "Welcome, Tony\nUsage\n30d\nCredits remaining\nCredits usage\n$0.23\n$9.79\nTokens\n82,537",
    // During xAI's partial render, the remaining amount is not mounted yet,
    // but the usage amount already exists in the shared summary card.
    dom: new FakeElement({ children: [balanceControls, usageGroup] }),
  });
  assert.equal(byKey(parse())["xai-credit"], undefined);
});

test("Grok weekly SuperGrok usage is converted to remaining capacity", () => {
  assert.equal(PROVIDERS.find((provider) => provider.id === "grok").collection.navigateOnCollect, true);
  // Grok's animated number exposes its value through aria-label rather than
  // rendered innerText. The surrounding card supplies "used" and the reset.
  const percentage = new FakeElement({ attributes: { "aria-label": "12%", role: "img" } });
  const card = new FakeElement({ children: [
    percentage,
    new FakeElement({ textContent: "used" }),
    new FakeElement({ textContent: "Resets August 26, 2026 at 8:58 AM" }),
    new FakeElement({ textContent: "Grok Build" }),
    new FakeElement({ textContent: "12%" }),
  ] });
  const section = new FakeElement({ children: [new FakeElement({ textContent: "Weekly SuperGrok Limit" }), card] });
  setPage({
    hostname: "grok.com",
    href: "https://grok.com/?q=&reasoningMode=none&voice=false&_s=usage",
    text: "Usage\nWeekly SuperGrok Limit\nused\nResets August 26, 2026 at 8:58 AM\nGrok Build\n12%\nExtra Usage Credits\nAdditional Credits\nBuy Credits",
    dom: new FakeElement({ children: [section] }),
  });
  const { "grok-weekly": metric } = byKey(parse());
  assert.equal(metric.value, 88);
  assert.equal(metric.display, "88%");
  assert.equal(metric.resetText, "Resets August 26, 2026 at 8:58 AM");
});

test("Grok Premium usage reads the animated total, reset, and zero extra credits", () => {
  // October 2026 layout: the total is accessible only via aria-label;
  // product breakdown percentages appear separately below it.
  const weekly = new FakeElement({ children: [
    new FakeElement({ children: [new FakeElement({ textContent: "Weekly Premium Limit" })] }),
    new FakeElement({ children: [
      new FakeElement({ attributes: { "aria-label": "8%", role: "img" } }),
      new FakeElement({ textContent: "used" }),
      new FakeElement({ textContent: "Resets October 21, 2026 at 9:28 PM" }),
      new FakeElement({ textContent: "Grok Bot" }),
      new FakeElement({ textContent: "8%" }),
    ] }),
  ] });
  const credits = new FakeElement({ children: [
    new FakeElement({ children: [
      new FakeElement({ children: [new FakeElement({ textContent: "Extra Usage Credits" })] }),
      new FakeElement({ textContent: "Manage" }),
    ] }),
    new FakeElement({ children: [
      new FakeElement({ attributes: { "aria-label": "$0.00", role: "img" } }),
      new FakeElement({ textContent: "Additional Credits" }),
    ] }),
  ] });
  setPage({
    hostname: "grok.com",
    text: "Usage\nWeekly Premium Limit\nused\nResets October 21, 2026 at 9:28 PM\nGrok Bot\n8%\nExtra Usage Credits\nManage\nAdditional Credits",
    dom: new FakeElement({ children: [weekly, credits] }),
  });
  const results = byKey(parse());
  assert.equal(results["grok-weekly"].value, 92);
  assert.equal(results["grok-weekly"].display, "92%");
  assert.equal(results["grok-weekly"].resetText, "Resets October 21, 2026 at 9:28 PM");
  assert.equal(results["grok-extra-credit"].value, 0);
  assert.equal(results["grok-extra-credit"].display, "$0.00");
});

test("Grok weekly usage keeps supporting the previous Weekly Limit heading", () => {
  setPage({
    hostname: "grok.com",
    href: "https://grok.com/?q=&reasoningMode=none&voice=false&_s=usage",
    text: "Usage\nWeekly Limit\n3% used\nResets in 7 days\nExtra Usage Credits",
  });
  const { "grok-weekly": metric } = byKey(parse());
  assert.equal(metric.value, 97);
  assert.equal(metric.display, "97%");
  assert.equal(metric.resetText, "Resets in 7 days");
});

test("Grok extra usage credits are read from the accessible animated balance", () => {
  const creditsHeading = new FakeElement({ textContent: "Extra Usage Credits" });
  const headingWrapper = new FakeElement({ children: [creditsHeading] });
  const animatedBalance = new FakeElement({ attributes: { "aria-label": "$12.50", role: "img" } });
  const creditsCard = new FakeElement({ children: [
    headingWrapper,
    animatedBalance,
    new FakeElement({ textContent: "Additional Credits" }),
    new FakeElement({ textContent: "Buy Credits" }),
  ] });
  setPage({
    hostname: "grok.com",
    href: "https://grok.com/?q=&reasoningMode=none&voice=false&_s=usage",
    text: "Usage\nWeekly SuperGrok Limit\n0% used\nExtra Usage Credits\nAdditional Credits\nBuy Credits",
    dom: creditsCard,
  });
  const { "grok-extra-credit": metric } = byKey(parse());
  assert.equal(metric.value, 1250);
  assert.equal(metric.display, "$12.50");
  assert.equal(metric.provider, "Grok / Cursor Credits");
});

test("Grok extra usage credits preserve a displayed zero balance", () => {
  const creditsHeading = new FakeElement({ textContent: "Extra Usage Credits" });
  const animatedBalance = new FakeElement({ attributes: { "aria-label": "$0.00", role: "img" } });
  const creditsCard = new FakeElement({ children: [creditsHeading, animatedBalance, new FakeElement({ textContent: "Additional Credits" })] });
  setPage({
    hostname: "grok.com",
    href: "https://grok.com/?q=&reasoningMode=none&voice=false&_s=usage",
    text: "Usage\nExtra Usage Credits\nAdditional Credits",
    dom: creditsCard,
  });
  const { "grok-extra-credit": metric } = byKey(parse());
  assert.equal(metric.value, 0);
  assert.equal(metric.display, "$0.00");
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


test("Claude redesigned usage page reads the total balance, This week, and No spend limit", () => {
  setPage({
    hostname: "claude.ai",
    text: [
      "Your usage", "Pro", "Fresh week. 2% of your weekly limit used.",
      "Current session", "Starts with your first message", "0% used",
      "This week", "Resets Saturday 11:00 AM", "2% used",
      "Usage credits",
      "Available for any task. Promotional credits are used before purchased credits.",
      "$38",
      "Turn on usage credits to keep using Claude if you hit a plan limit. Learn more",
      "Credit type\tGranted\tSpent\tRemaining",
      "Purchased\tNot available\tNot available\t$38",
      "Buy more usage", "Up to 30% off",
      "Once you hit your weekly limit, your usage credits will be spent.",
      "Monthly spend limit", "$0.00 this month · No spend limit · Auto-reload off",
      "Credits are spent automatically past your plan limits.", "Manage",
      "This week’s usage by product", "Claude Code", "100%", "Chats", "0%",
    ].join("\n"),
  });
  const results = byKey(parse());
  assert.equal(results["claude-session"].value, 100);
  assert.equal(results["claude-session"].resetText, undefined);
  assert.equal(results["claude-weekly"].value, 98);
  assert.equal(results["claude-weekly"].resetText, "Resets Saturday 11:00 AM");
  assert.equal(results["claude-usage-credit"].value, 3800);
  assert.equal(results["claude-usage-cap"].availability, "unlimited");
});

test("X Subscription collects one shared weekly pool and available credits, not monthly spending", () => {
  const provider = PROVIDERS.find((candidate) => candidate.id === "grok");
  assert.equal(provider.url, "https://grok.com/dashboard/");
  const balance = new FakeElement({ children: [
    new FakeElement({ textContent: "Credits available" }),
    new FakeElement({ textContent: "$4.25" }),
  ] });
  setPage({ hostname: "grok.com", text: "Weekly included usage\n27% used\nResets October 21, 2026 at 9:28 PM\nMonthly additional usage limit\n$0.15 used this month\nCredits available\n$4.25", dom: new FakeElement({ children: [new FakeElement({ textContent: "$0.15 used this month" }), balance] }) });
  const results = byKey(parse());
  assert.equal(results["grok-weekly"].value, 73);
  assert.equal(results["grok-weekly"].resetText, "Resets October 21, 2026 at 9:28 PM");
  assert.equal(results["grok-extra-credit"].value, 425);
  assert.equal(Object.keys(results).length, 2);
});

test("X Subscription unavailable weekly pool never borrows a product percentage", () => {
  const balance = new FakeElement({ children: [new FakeElement({ textContent: "Credits available" }), new FakeElement({ textContent: "$0.00" })] });
  setPage({ hostname: "grok.com", text: "Weekly usage is temporarily unavailable\nWeekly included usage\nResets weekly\nCursor\n12% used\nCredits available\n$0.00", dom: balance });
  const results = byKey(parse());
  assert.equal(results["grok-weekly"], undefined);
  assert.equal(results["grok-extra-credit"].value, 0);
});

test("Grok reports provider-side weekly unavailability while keeping credits readable", () => {
  const spec = PROVIDERS.find((provider) => provider.id === "grok");
  setPage({ hostname: "grok.com", text: "Weekly usage is temporarily unavailable\nCredits available\n$0.00" });
  assert.deepEqual(inspectProviderPage(spec), { state: "ready", errorCode: "provider-usage-unavailable" });
});

test("unified Grok dashboard reads named meter with usage before the caption", () => {
  const meter = new FakeElement({ attributes: { role: "meter", "aria-label": "Weekly included usage", "aria-valuenow": "37.313109425785484", "aria-valuetext": "37% used" } });
  const card = new FakeElement({ children: [new FakeElement({ textContent: "37%\nused" }), meter, new FakeElement({ textContent: "Weekly included usage" }), new FakeElement({ textContent: "· Resets Oct 21" })] });
  setPage({ hostname: "grok.com", text: "Current plan\nPremium\n37%\nused\nWeekly included usage\n· Resets Oct 21\nIncluded usage with your subscription. Used before your credits.", dom: card });
  const metric = byKey(parse())["grok-weekly"];
  assert.equal(metric.value, 63);
  assert.equal(metric.resetText, "Resets Oct 21");
});
