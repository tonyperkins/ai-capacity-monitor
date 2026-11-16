import assert from "node:assert/strict";
import test from "node:test";
import * as claude from "../sources/claude.js";
import * as codex from "../sources/codex.js";
import * as devin from "../sources/devin.js";
import * as gemini from "../sources/gemini.js";
import * as grok from "../sources/grok.js";
import { parseClockReset } from "../lib/limits.js";

const NOW = new Date("2026-11-16T01:00:00Z"); // Sun Nov 15, 7:00 PM in Chicago

test("claude: every usage line becomes a limit, including one that comes and goes", () => {
  const limits = claude.parse([
    "You are currently using your subscription to power your Claude Code usage",
    "",
    "Current session: 45% used · resets Nov 15, 11:09pm (America/Chicago)",
    "Current week (all models): 13% used · resets Nov 21, 10am (America/Chicago)",
    "Current week (Fable): 17% used · resets Nov 21, 10am (America/Chicago)",
    "",
    "Last 24h · 69 requests · 2 sessions",
    "  74%  Start fresh when you switch tasks · run /clear",
    "  Top MCP servers: craft-anything 1%, agent-manager 1%",
  ].join("\n"), NOW);
  assert.deepEqual(limits, [
    { id: "current-session", label: "Current session", remaining: 55, resetAt: "2026-11-16T05:09:00.000Z", windowMs: 18000000 },
    { id: "current-week-all-models", label: "Current week (all models)", remaining: 87, resetAt: "2026-11-21T16:00:00.000Z", windowMs: 604800000 },
    { id: "current-week-fable", label: "Current week (Fable)", remaining: 83, resetAt: "2026-11-21T16:00:00.000Z", windowMs: 604800000, parent: "current-week-all-models" },
  ]);
});

test("claude: a line without a reset is kept, and unrelated output is an error", () => {
  assert.deepEqual(claude.parse("Current session: 0% used", NOW), [{ id: "current-session", label: "Current session", remaining: 100, resetAt: null, windowMs: 18000000 }]);
  assert.throws(() => claude.parse("Total cost: $0.0000\nUsage: 0 input", NOW), { code: "bad-output" });
});

test("clock resets: time only rolls to tomorrow, and a past date rolls to next year", () => {
  assert.equal(parseClockReset("11:10pm", "America/Chicago", NOW), "2026-11-16T05:10:00.000Z");
  assert.equal(parseClockReset("6:00pm", "America/Chicago", NOW), "2026-11-17T00:00:00.000Z");
  assert.equal(parseClockReset("Jan 2, 9am", "America/Chicago", NOW), "2027-01-02T15:00:00.000Z");
  assert.equal(parseClockReset("sometime soon", "America/Chicago", NOW), null);
});

test("chatgpt: both windows of every limit id", () => {
  const limits = codex.parse({ rateLimitsByLimitId: {
    codex: { limitId: "codex", limitName: null, primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794809344 }, secondary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1795096366 } },
    review: { limitId: "review", limitName: "Code review", primary: { usedPercent: 10, windowDurationMins: 1440, resetsAt: 1794809344 }, secondary: null },
  } });
  assert.deepEqual(limits.map((limit) => [limit.id, limit.label, limit.remaining, limit.windowMs]), [
    ["codex-primary", "5-hour limit", 100, 18000000],
    ["codex-secondary", "Weekly limit", 66, 604800000],
    ["review-primary", "Code review · Daily limit", 90, 86400000],
  ]);
  assert.equal(limits[1].resetAt, "2026-11-19T13:52:46.000Z");
  assert.throws(() => codex.parse({}), { code: "bad-output" });
});

test("gemini: tab-separated quota lines, grouped", () => {
  const limits = gemini.parse([
    "Gemini Models\tWeekly Limit Remaining\t91%\t2026-11-21T16:06:09Z",
    "Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t45%\t2026-11-21T16:04:05Z",
    "Claude and GPT models\tFive Hour Limit Remaining\t100%\t",
  ].join("\n"));
  assert.deepEqual(limits, [
    { id: "gemini-models-weekly-limit", label: "Gemini Models · Weekly Limit", remaining: 91, resetAt: "2026-11-21T16:06:09.000Z", windowMs: 604800000, group: "Gemini Models" },
    { id: "gemini-4-argon-weekly-limit", label: "Gemini 4 Argon · Weekly Limit", remaining: 45, resetAt: "2026-11-21T16:04:05.000Z", windowMs: 604800000, group: "Gemini 4 Argon" },
    { id: "claude-and-gpt-models-five-hour-limit", label: "Claude and GPT models · Five Hour Limit", remaining: 100, resetAt: null, windowMs: 18000000, group: "Claude and GPT models" },
  ]);
  assert.throws(() => gemini.parse("Please sign in"), { code: "bad-output" });
});

test("grok: weekly credit usage with its real window", () => {
  assert.deepEqual(grok.parse({ config: { creditUsagePercent: 50, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-12T02:28:50.081+00:00", end: "2026-11-19T02:28:50.081+00:00" } } }), [
    { id: "weekly", label: "Weekly limit", remaining: 50, resetAt: "2026-11-19T02:28:50.081Z", windowMs: 604800000 },
  ]);
  assert.throws(() => grok.parse({ config: { monthlyLimit: { val: 0 } } }), { code: "bad-output" });
});

test("devin: every quota period in the plan status", () => {
  const limits = devin.parse({ userStatus: { planStatus: { dailyQuotaRemainingPercent: 95, weeklyQuotaRemainingPercent: 97, dailyQuotaResetAtUnix: "1794816000", weeklyQuotaResetAtUnix: "1795334400", availablePromptCredits: -1 } } });
  assert.deepEqual(limits, [
    { id: "daily", label: "Daily quota", remaining: 95, resetAt: "2026-11-16T08:00:00.000Z", windowMs: 86400000 },
    { id: "weekly", label: "Weekly quota", remaining: 97, resetAt: "2026-11-22T08:00:00.000Z", windowMs: 604800000 },
  ]);
  assert.throws(() => devin.parse({ userStatus: {} }), { code: "bad-output" });
});
