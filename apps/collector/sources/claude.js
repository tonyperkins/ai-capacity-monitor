import { fail, run } from "../lib/exec.js";
import { inferWindowMs, parseClockReset, slug } from "../lib/limits.js";

export const id = "claude";
export const name = "Claude";

// Reads lines such as
//   Current week (Fable): 13% used · resets Nov 21, 10am (America/Chicago)
// Any line of that shape becomes a limit, whatever its label.
export function parse(text, now = new Date()) {
  const limits = [];
  for (const line of String(text).split("\n")) {
    const match = /^\s*(.+?):\s*(\d+(?:\.\d+)?)%\s*(used|remaining|left)(?:\s*·\s*resets\s+(.+?)(?:\s*\(([^)]+)\))?)?\s*$/i.exec(line);
    if (!match) continue;
    const amount = Number(match[2]);
    limits.push({
      id: slug(match[1]),
      label: match[1].trim(),
      remaining: /used/i.test(match[3]) ? 100 - amount : amount,
      resetAt: match[4] ? parseClockReset(match[4], match[5], now) : null,
      windowMs: inferWindowMs(match[1]),
    });
  }
  if (!limits.length) throw fail("bad-output");
  // "Current week (Fable)" is a share of "Current week (all models)".
  for (const limit of limits) {
    const scoped = /^(.*?)\s*\((.+)\)$/.exec(limit.label);
    if (!scoped || /^all\b/i.test(scoped[2])) continue;
    const whole = limits.find((other) => other !== limit && new RegExp(`^${scoped[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(all\\b`, "i").test(other.label));
    if (whole) limit.parent = whole.id;
  }
  return limits;
}

export async function read({ command = "claude", now } = {}) {
  // No MCP servers, user settings or saved session: /usage needs none of them.
  const text = await run(command, ["-p", "/usage", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", ""]);
  return parse(text, now);
}
