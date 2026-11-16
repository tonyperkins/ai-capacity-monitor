import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { collect } from "./collect.js";

// Reuses the display section of the existing bridge config, so a display
// already provisioned with that address and token keeps working.
const configPath = process.env.CAPACITY_COLLECTOR_CONFIG ?? path.join(os.homedir(), ".config", "ai-capacity-monitor", "collector.json");
const once = process.argv.includes("--once");

async function loadConfig() {
  let raw = {};
  try { raw = JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT" || !once) throw new Error(`Cannot read ${configPath}`); }
  const settings = raw.collector ?? {};
  const interval = Number(settings.intervalMinutes ?? 10);
  return {
    host: raw.display?.host ?? "0.0.0.0",
    port: Number(process.env.CAPACITY_DISPLAY_PORT ?? raw.display?.port ?? 8788),
    token: raw.display?.token,
    snapshotPath: process.env.CAPACITY_SNAPSHOT_PATH ?? raw.display?.snapshotPath ?? path.join(path.dirname(configPath), "latest-snapshot.json"),
    intervalMs: Math.max(1, Math.min(1440, Number.isFinite(interval) ? interval : 10)) * 60000,
    enabled: settings.sources ?? {},
    options: settings.options ?? {},
    hide: Array.isArray(settings.hide) ? settings.hide : [],
  };
}

async function loadSnapshot(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function saveSnapshot(file, snapshot) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

function sameSecret(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

const config = await loadConfig();

if (once) {
  const snapshot = await collect({ enabled: config.enabled, options: config.options, hide: config.hide, previous: await loadSnapshot(config.snapshotPath) });
  if (process.argv.includes("--write")) await saveSnapshot(config.snapshotPath, snapshot);
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  if (!config.token) throw new Error("display.token is required in the config to serve the display");
  let latest = await loadSnapshot(config.snapshotPath);
  let running = null;
  let lastStarted = 0;
  const refresh = () => {
    lastStarted = Date.now();
    running ??= collect({ enabled: config.enabled, options: config.options, hide: config.hide, previous: latest })
      .then(async (snapshot) => {
        latest = snapshot;
        await saveSnapshot(config.snapshotPath, snapshot);
        console.log(`collected ${snapshot.metrics.length} limits; ${Object.entries(snapshot.sources).map(([id, state]) => `${id}=${state}`).join(" ")}`);
      })
      .catch((error) => console.error(`collection failed: ${error?.message ?? error}`))
      .finally(() => { running = null; });
    return running;
  };
  http.createServer((request, response) => {
    if (request.method !== "GET") return sendJson(response, 404, { error: "not-found" });
    if (request.url === "/health") return sendJson(response, 200, { status: "ok", collectedAt: latest?.collectedAt ?? null, sources: latest?.sources ?? {} });
    if (request.url !== "/snapshot/v1") return sendJson(response, 404, { error: "not-found" });
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!sameSecret(config.token, token)) return sendJson(response, 401, { error: "unauthorized" });
    // The display asks for a fresh reading with this header. The reply is
    // still the current snapshot; the new one is ready a few seconds later.
    // At most one extra pass every 30 seconds.
    if (request.headers["x-capacity-refresh"] === "1" && !running && Date.now() - lastStarted > 30000) refresh();
    if (!latest) return sendJson(response, 503, { error: "snapshot-unavailable" });
    return sendJson(response, 200, latest);
  }).listen(config.port, config.host, () => console.log(`Capacity collector serving ${config.host}:${config.port}, collecting every ${config.intervalMs / 60000} min`));
  refresh();
  setInterval(refresh, config.intervalMs);
}
