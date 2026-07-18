/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COLLECTOR_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ingest") return ingest(request, env);
    if (url.pathname === "/api/status") return status(env);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

// Mirrors packages/contract/snapshot.v1.json. Kept as a hand-written
// validator rather than a generic JSON-Schema library: Cloudflare Workers
// don't allow the runtime eval() that most schema validators (e.g. ajv)
// compile validators with.
type SnapshotMetric = {
  key: string;
  provider: string;
  label: string;
  kind: "credit" | "quota";
  value: number;
  unit: "usd" | "percent" | "count";
  status: "verified" | "unverified";
  readState?: "validated" | "suspicious-held" | "retained-prior" | "unauthenticated" | "permission-needed" | "failed";
  attemptedAt?: string;
  errorCode?: string | null;
  resetAt?: string;
  collectedAt?: string;
  display?: string;
  resetText?: string;
};

type SnapshotDiagnostic = {
  key: string;
  providerId: string;
  state: NonNullable<SnapshotMetric["readState"]>;
  errorCode?: string | null;
  attemptedAt: string;
};

type Snapshot = { version: "1"; collectedAt: string; metrics: SnapshotMetric[]; diagnostics?: SnapshotDiagnostic[]; issues: string[] };

function isValidMetric(value: unknown): value is SnapshotMetric {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.key === "string" && m.key.length > 0 && m.key.length <= 80 &&
    typeof m.provider === "string" && m.provider.length > 0 && m.provider.length <= 80 &&
    typeof m.label === "string" && m.label.length > 0 && m.label.length <= 100 &&
    (m.kind === "credit" || m.kind === "quota") &&
    Number.isFinite(m.value) &&
    (m.unit === "usd" || m.unit === "percent" || m.unit === "count") &&
    (m.status === "verified" || m.status === "unverified") &&
    (m.readState === undefined || m.readState === "validated" || m.readState === "suspicious-held" || m.readState === "retained-prior" || m.readState === "unauthenticated" || m.readState === "permission-needed" || m.readState === "failed") &&
    (m.attemptedAt === undefined || typeof m.attemptedAt === "string") &&
    (m.errorCode === undefined || m.errorCode === null || (typeof m.errorCode === "string" && m.errorCode.length <= 80)) &&
    (m.display === undefined || (typeof m.display === "string" && m.display.length <= 40)) &&
    (m.resetText === undefined || (typeof m.resetText === "string" && m.resetText.length <= 160)) &&
    (m.resetAt === undefined || typeof m.resetAt === "string") &&
    (m.collectedAt === undefined || typeof m.collectedAt === "string")
  );
}

function isValidDiagnostic(value: unknown): value is SnapshotDiagnostic {
  if (typeof value !== "object" || value === null) return false;
  const diagnostic = value as Record<string, unknown>;
  return typeof diagnostic.key === "string" && diagnostic.key.length > 0 && diagnostic.key.length <= 80 &&
    typeof diagnostic.providerId === "string" && diagnostic.providerId.length > 0 && diagnostic.providerId.length <= 80 &&
    (diagnostic.state === "validated" || diagnostic.state === "suspicious-held" || diagnostic.state === "retained-prior" || diagnostic.state === "unauthenticated" || diagnostic.state === "permission-needed" || diagnostic.state === "failed") &&
    (diagnostic.errorCode === undefined || diagnostic.errorCode === null || (typeof diagnostic.errorCode === "string" && diagnostic.errorCode.length <= 80)) &&
    typeof diagnostic.attemptedAt === "string" && !Number.isNaN(Date.parse(diagnostic.attemptedAt));
}

function isValidSnapshot(body: unknown): body is Snapshot {
  if (typeof body !== "object" || body === null) return false;
  const snapshot = body as Record<string, unknown>;
  if (snapshot.version !== "1") return false;
  if (typeof snapshot.collectedAt !== "string" || Number.isNaN(Date.parse(snapshot.collectedAt))) return false;
  if (!Array.isArray(snapshot.issues) || !snapshot.issues.every((issue) => typeof issue === "string")) return false;
  if (!Array.isArray(snapshot.metrics) || snapshot.metrics.length > 24 || !snapshot.metrics.every(isValidMetric)) return false;
  return snapshot.diagnostics === undefined || (Array.isArray(snapshot.diagnostics) && snapshot.diagnostics.length <= 24 && snapshot.diagnostics.every(isValidDiagnostic));
}

async function ingest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.COLLECTOR_TOKEN || request.headers.get("authorization") !== `Bearer ${env.COLLECTOR_TOKEN}`) return new Response("Unauthorized", { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isValidSnapshot(body)) return new Response("Invalid payload", { status: 400 });
  const { collectedAt, metrics } = body;
  // A retained or failed reading belongs in diagnostics, not a new historical
  // row. Only a fresh validated value advances dashboard history.
  const freshMetrics = metrics.filter((metric) => metric.readState === undefined ? metric.status === "verified" : metric.readState === "validated");
  if (freshMetrics.length) await env.DB.batch(freshMetrics.map((m) => env.DB.prepare("INSERT INTO metrics (collected_at, metric_key, provider, label, kind, value, display, reset_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(m.collectedAt ?? collectedAt, m.key, m.provider, m.label, m.kind, Math.round(m.value), m.display ?? "", m.resetText ?? null)));
  return Response.json({ accepted: freshMetrics.length });
}

async function status(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT metric_key as key, provider, label, kind, value, display, reset_text as resetText, collected_at as collectedAt FROM metrics WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY metric_key) ORDER BY provider, label").all();
  return Response.json({ metrics: result.results, collectedAt: result.results.reduce((latest: string | null, row: unknown) => { const at = (row as { collectedAt: string }).collectedAt; return !latest || at > latest ? at : latest; }, null as string | null) }, { headers: { "cache-control": "no-store" } });
}

export default worker;
