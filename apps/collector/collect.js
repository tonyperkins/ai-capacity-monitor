import * as claude from "./sources/claude.js";
import * as codex from "./sources/codex.js";
import * as gemini from "./sources/gemini.js";
import * as grok from "./sources/grok.js";
import * as devin from "./sources/devin.js";

export const SOURCES = [claude, codex, gemini, grok, devin];
const MAX_METRICS = 24;
const MAX_WINDOW_MS = 2678400000;

function resetText(resetAt) {
  if (!resetAt) return undefined;
  return `Resets ${new Date(resetAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

// One limit from a source -> one snapshot.v1 metric. Fields beyond the v1
// contract (providerId, group, parent) are optional extras consumers may ignore.
function toMetric(source, limit, at) {
  const value = Math.max(0, Math.min(100, Math.round(limit.remaining)));
  return {
    key: `${source.id}/${limit.id}`,
    providerId: source.id,
    provider: source.name,
    label: String(limit.label).slice(0, 100),
    kind: "quota",
    unit: "percent",
    value,
    display: `${value}%`,
    status: "verified",
    readState: "validated",
    errorCode: null,
    attemptedAt: at,
    collectedAt: at,
    ...(limit.resetAt ? { resetAt: limit.resetAt, resetText: resetText(limit.resetAt) } : {}),
    ...(limit.windowMs ? { resetWindowMs: Math.min(MAX_WINDOW_MS, Math.round(limit.windowMs)) } : {}),
    ...(limit.group ? { group: String(limit.group).slice(0, 80) } : {}),
    ...(limit.parent ? { parent: `${source.id}/${limit.parent}` } : {}),
  };
}

// Reads every enabled source. A source that answers replaces its own lines
// outright, so limits that vanish upstream vanish here. A source that fails
// keeps its previous lines, marked as prior values.
// `hide` lists limits to leave out of the snapshot. An entry matches a limit's
// key, its group or its label, ignoring case.
export async function collect({ sources = SOURCES, enabled = {}, previous = null, now = new Date(), options = {}, hide = [] } = {}) {
  const hidden = new Set(hide.map((entry) => String(entry).toLowerCase()));
  const isHidden = (metric) => [metric.key, metric.group, metric.label].some((text) => text && hidden.has(String(text).toLowerCase()));
  const at = now.toISOString();
  const active = sources.filter((source) => enabled[source.id] !== false);
  const results = await Promise.all(active.map(async (source) => {
    try { return { source, limits: await source.read({ now, ...(options[source.id] ?? {}) }) }; }
    catch (error) { return { source, errorCode: String(error?.code ?? "failed").slice(0, 80) }; }
  }));
  const metrics = [];
  const issues = [];
  const sourceStates = {};
  for (const { source, limits, errorCode } of results) {
    if (limits) {
      sourceStates[source.id] = "validated";
      metrics.push(...limits.map((limit) => toMetric(source, limit, at)).filter((metric) => !isHidden(metric)));
      continue;
    }
    const prior = (previous?.metrics ?? []).filter((metric) => metric.providerId === source.id && !isHidden(metric));
    sourceStates[source.id] = prior.length ? "retained-prior" : "failed";
    metrics.push(...prior.map((metric) => ({ ...metric, status: "unverified", readState: "retained-prior", errorCode, attemptedAt: at })));
    issues.push(prior.length
      ? `${source.name}: could not read this time (${errorCode}); showing the last values.`
      : `${source.name}: no reading available (${errorCode}).`);
  }
  if (metrics.length > MAX_METRICS) issues.push(`Showing ${MAX_METRICS} of ${metrics.length} limits.`);
  const shown = metrics.slice(0, MAX_METRICS);
  return {
    version: "1",
    collectedAt: at,
    metrics: shown,
    diagnostics: shown.map((metric) => ({ key: metric.key, providerId: metric.providerId, state: metric.readState, errorCode: metric.errorCode, attemptedAt: metric.attemptedAt })),
    issues,
    sources: sourceStates,
  };
}
