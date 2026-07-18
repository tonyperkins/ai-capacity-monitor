import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { validateSnapshot } from "./snapshot.js";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_QUEUE_LIMIT = 50;
const RETRY_BASE_MS = 5 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function validateDestination(destination) {
  if (!destination || destination.type !== "webhook" || typeof destination.url !== "string") return { ok: false, error: "destination-missing" };
  try {
    const url = new URL(destination.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) return { ok: false, error: "destination-requires-https" };
    if (destination.headers !== undefined && (!destination.headers || typeof destination.headers !== "object" || Array.isArray(destination.headers))) return { ok: false, error: "invalid-destination-headers" };
    return { ok: true, url };
  } catch {
    return { ok: false, error: "invalid-destination-url" };
  }
}

// Converts the private prototype config once. New configs always use the
// generic webhook shape, including when the target happens to be a Sites app.
export function normalizeConfig(config, { configPath } = {}) {
  const queuePath = config.queue?.path ?? path.join(path.dirname(configPath ?? process.cwd()), "queue.json");
  const destination = config.destination ?? (config.siteUrl ? {
    type: "webhook",
    url: new URL("/api/ingest", config.siteUrl).href,
    headers: {
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(config.sitesBypassToken ? { "OAI-Sites-Authorization": `Bearer ${config.sitesBypassToken}` } : {}),
    },
  } : null);
  const queueLimit = Number(config.queue?.maxItems ?? DEFAULT_QUEUE_LIMIT);
  if (!Number.isInteger(queueLimit) || queueLimit < 1 || queueLimit > 500) throw new Error("queue.maxItems must be an integer from 1 to 500");
  const destinationCheck = validateDestination(destination);
  if (!destinationCheck.ok) throw new Error(`Invalid destination: ${destinationCheck.error}`);
  return { collectorSecret: config.collectorSecret, destination, queuePath, queueLimit, migratedLegacyDestination: !config.destination && Boolean(config.siteUrl) };
}

async function loadQueue(queuePath) {
  try {
    const data = JSON.parse(await readFile(queuePath, "utf8"));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error("Unable to read bridge queue");
  }
}

async function saveQueue(queuePath, entries) {
  await mkdir(path.dirname(queuePath), { recursive: true });
  const temporary = `${queuePath}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, entries }, null, 2), { mode: 0o600 });
  await rename(temporary, queuePath);
}

function retryDelay(attempts) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

function sameSecret(expected, received) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { ok: false, status: 413, error: "payload-too-large" };
  }
  try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false, status: 400, error: "invalid-json" }; }
}

export async function createBridge({ config, fetchImpl = fetch, now = () => Date.now(), schedule = setTimeout } = {}) {
  if (!config?.collectorSecret) throw new Error("collectorSecret is required");
  const destinationCheck = validateDestination(config.destination);
  if (!destinationCheck.ok) throw new Error(`Invalid destination: ${destinationCheck.error}`);
  let entries = await loadQueue(config.queuePath);
  let activeDrain = null;
  let retryTimer = null;
  const status = { startedAt: new Date(now()).toISOString(), lastReceivedAt: null, lastDelivery: { state: "idle", at: null, code: null } };

  const persist = () => saveQueue(config.queuePath, entries);
  const health = () => ({ status: "ok", queueSize: entries.length, lastReceivedAt: status.lastReceivedAt, lastDelivery: status.lastDelivery });
  const scheduleRetry = () => {
    if (retryTimer || !entries.length) return;
    const delay = Math.max(0, (entries[0].nextAttemptAt ?? now()) - now());
    retryTimer = schedule(() => { retryTimer = null; drain(); }, delay);
  };
  async function drain({ force = false } = {}) {
    if (activeDrain) return activeDrain;
    activeDrain = (async () => {
      while (entries.length) {
        const entry = entries[0];
        if (!force && entry.nextAttemptAt > now()) { scheduleRetry(); return; }
        try {
          const response = await fetchImpl(config.destination.url, {
            method: "POST",
            headers: { "content-type": "application/json", ...config.destination.headers },
            body: JSON.stringify(entry.snapshot),
          });
          if (!response.ok) throw new Error(`destination-http-${response.status}`);
          entries.shift();
          await persist();
          status.lastDelivery = { state: "delivered", at: new Date(now()).toISOString(), code: null };
        } catch (error) {
          entry.attempts += 1;
          entry.nextAttemptAt = now() + retryDelay(entry.attempts);
          await persist();
          status.lastDelivery = { state: "delayed", at: new Date(now()).toISOString(), code: String(error.message ?? "destination-unreachable").slice(0, 80) };
          scheduleRetry();
          return;
        }
      }
    })().finally(() => { activeDrain = null; });
    return activeDrain;
  }
  async function receive(snapshot) {
    if (entries.length >= config.queueLimit) return { ok: false, error: "queue-full" };
    entries.push({ id: crypto.randomUUID(), snapshot, attempts: 0, nextAttemptAt: now() });
    await persist();
    status.lastReceivedAt = new Date(now()).toISOString();
    await drain();
    return { ok: true, queued: entries.length };
  }
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return sendJson(response, 200, health());
    if (request.method !== "POST" || request.url !== "/collect") return sendJson(response, 404, { error: "not-found" });
    if (!sameSecret(config.collectorSecret, request.headers["x-collector-secret"])) return sendJson(response, 401, { error: "unauthorized" });
    const body = await readJson(request);
    if (!body.ok) return sendJson(response, body.status, { error: body.error });
    const validation = validateSnapshot(body.value);
    if (!validation.ok) return sendJson(response, 400, { error: validation.error });
    try {
      const result = await receive(body.value);
      return result.ok ? sendJson(response, 202, { accepted: body.value.metrics.length, queued: result.queued }) : sendJson(response, 503, { error: result.error });
    } catch {
      return sendJson(response, 503, { error: "queue-unavailable" });
    }
  });
  queueMicrotask(() => drain());
  return { server, drain, health, receive, close: () => { if (retryTimer) clearTimeout(retryTimer); } };
}
