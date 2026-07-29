const METRIC_STATES = new Set(["validated", "suspicious-held", "retained-prior", "unauthenticated", "permission-needed", "failed"]);
const LEGACY_STATUSES = new Set(["verified", "unverified"]);

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function validOptionalString(value, maxLength) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= maxLength);
}

function validMetric(metric) {
  return metric && typeof metric === "object" &&
    validString(metric.key, 80) && validString(metric.provider, 80) && validString(metric.label, 100) &&
    (metric.kind === "credit" || metric.kind === "quota") && Number.isInteger(metric.value) &&
    (metric.unit === "usd" || metric.unit === "percent" || metric.unit === "count") &&
    LEGACY_STATUSES.has(metric.status) &&
    (metric.readState === undefined || METRIC_STATES.has(metric.readState)) &&
    (metric.attemptedAt === undefined || validDate(metric.attemptedAt)) &&
    validOptionalString(metric.errorCode, 80) && validOptionalString(metric.display, 40) &&
    validOptionalString(metric.resetText, 160) &&
    (metric.resetAt === undefined || validDate(metric.resetAt)) &&
    (metric.resetWindowMs === undefined || (Number.isInteger(metric.resetWindowMs) && metric.resetWindowMs >= 1 && metric.resetWindowMs <= 2678400000)) &&
    (metric.collectedAt === undefined || validDate(metric.collectedAt));
}

function validDiagnostic(diagnostic) {
  return diagnostic && typeof diagnostic === "object" &&
    validString(diagnostic.key, 80) && validString(diagnostic.providerId, 80) &&
    METRIC_STATES.has(diagnostic.state) && validDate(diagnostic.attemptedAt) &&
    validOptionalString(diagnostic.errorCode, 80);
}

// Mirrors packages/contract/snapshot.v1.json without a runtime schema engine.
// It deliberately returns a safe code only: callers must not echo raw bodies.
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return { ok: false, error: "invalid-snapshot" };
  if (snapshot.version !== "1" || !validDate(snapshot.collectedAt)) return { ok: false, error: "invalid-snapshot-header" };
  if (!Array.isArray(snapshot.metrics) || snapshot.metrics.length > 24 || !snapshot.metrics.every(validMetric)) return { ok: false, error: "invalid-metrics" };
  if (!Array.isArray(snapshot.issues) || !snapshot.issues.every((issue) => typeof issue === "string" && issue.length <= 500)) return { ok: false, error: "invalid-issues" };
  if (snapshot.diagnostics !== undefined && (!Array.isArray(snapshot.diagnostics) || snapshot.diagnostics.length > 24 || !snapshot.diagnostics.every(validDiagnostic))) return { ok: false, error: "invalid-diagnostics" };
  return { ok: true };
}
