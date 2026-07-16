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

type Metric = { key: string; provider: string; label: string; kind: "credit" | "quota"; value: number; display: string; resetText?: string };

async function ingest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.COLLECTOR_TOKEN || request.headers.get("authorization") !== `Bearer ${env.COLLECTOR_TOKEN}`) return new Response("Unauthorized", { status: 401 });
  let body: { collectedAt?: string; metrics?: Metric[] };
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const collectedAt = body.collectedAt;
  const metrics = body.metrics;
  if (!collectedAt || !Array.isArray(metrics) || metrics.length === 0 || metrics.length > 24) return new Response("Invalid payload", { status: 400 });
  const safe = metrics.every((m) => typeof m.key === "string" && m.key.length < 80 && typeof m.provider === "string" && m.provider.length < 80 && typeof m.label === "string" && m.label.length < 100 && (m.kind === "credit" || m.kind === "quota") && Number.isFinite(m.value) && typeof m.display === "string" && m.display.length < 40 && (!m.resetText || m.resetText.length < 160));
  if (!safe) return new Response("Invalid metric", { status: 400 });
  await env.DB.batch(metrics.map((m) => env.DB.prepare("INSERT INTO metrics (collected_at, metric_key, provider, label, kind, value, display, reset_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(collectedAt, m.key, m.provider, m.label, m.kind, Math.round(m.value), m.display, m.resetText ?? null)));
  return Response.json({ accepted: metrics.length });
}

async function status(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT metric_key as key, provider, label, kind, value, display, reset_text as resetText, collected_at as collectedAt FROM metrics WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY metric_key) ORDER BY provider, label").all();
  return Response.json({ metrics: result.results, collectedAt: result.results.reduce((latest: string | null, row: unknown) => { const at = (row as { collectedAt: string }).collectedAt; return !latest || at > latest ? at : latest; }, null as string | null) }, { headers: { "cache-control": "no-store" } });
}

export default worker;
