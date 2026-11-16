import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fail } from "../lib/exec.js";
import { inferWindowMs, isoOrNull } from "../lib/limits.js";

export const id = "devin";
export const name = "Devin";

const CREDENTIALS = path.join(os.homedir(), ".local", "share", "devin", "credentials.toml");

// planStatus carries pairs like weeklyQuotaRemainingPercent and
// weeklyQuotaResetAtUnix. Every such pair becomes a limit.
export function parse(body) {
  const plan = body?.userStatus?.planStatus ?? body?.planStatus;
  if (!plan || typeof plan !== "object") throw fail("bad-output");
  const limits = [];
  for (const [key, value] of Object.entries(plan)) {
    const match = /^([a-z][A-Za-z0-9]*)QuotaRemainingPercent$/.exec(key);
    if (!match || !Number.isFinite(Number(value))) continue;
    const period = match[1];
    const reset = Number(plan[`${period}QuotaResetAtUnix`]);
    limits.push({
      id: period.toLowerCase(),
      label: `${period[0].toUpperCase()}${period.slice(1)} quota`,
      remaining: Number(value),
      resetAt: Number.isFinite(reset) && reset > 0 ? isoOrNull(reset * 1000) : null,
      windowMs: inferWindowMs(period === "daily" ? "day" : period),
    });
  }
  if (!limits.length) throw fail("bad-output");
  return limits;
}

function tomlString(text, key) {
  return new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(text)?.[1] ?? null;
}

export async function read({ credentialsPath = CREDENTIALS, fetchImpl = fetch } = {}) {
  let toml;
  try { toml = await readFile(credentialsPath, "utf8"); } catch { throw fail("not-signed-in"); }
  const apiKey = tomlString(toml, "windsurf_api_key");
  const server = tomlString(toml, "api_server_url") ?? "https://server.codeium.com";
  if (!apiKey || !/^https:\/\//.test(server)) throw fail("not-signed-in");
  let response;
  try {
    response = await fetchImpl(`${server}/exa.seat_management_pb.SeatManagementService/GetUserStatus`, {
      method: "POST",
      headers: { "content-type": "application/json", "connect-protocol-version": "1" },
      // The server rejects a version that is not three dotted numbers.
      body: JSON.stringify({ metadata: { apiKey, ideName: "devin-cli", ideVersion: "1.0.0", extensionName: "devin-cli", extensionVersion: "1.0.0" } }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw fail("unreachable"); }
  if (response.status === 401 || response.status === 403) throw fail("not-signed-in");
  if (!response.ok) throw fail(`http-${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw fail("bad-output"); }
  return parse(body);
}
