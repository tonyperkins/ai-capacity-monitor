import { fail, rpc } from "../lib/exec.js";
import { isoOrNull } from "../lib/limits.js";

export const id = "chatgpt";
export const name = "ChatGPT";

function windowLabel(minutes) {
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10080) return "Weekly limit";
  if (minutes === 1440) return "Daily limit";
  return minutes % 60 === 0 ? `${minutes / 60}-hour limit` : `${minutes}-minute limit`;
}

// Every limit id the account reports, each with up to two windows.
export function parse(result) {
  const byId = result?.rateLimitsByLimitId ?? (result?.rateLimits ? { [result.rateLimits.limitId ?? "codex"]: result.rateLimits } : null);
  if (!byId || typeof byId !== "object") throw fail("bad-output");
  const limits = [];
  for (const [limitId, entry] of Object.entries(byId)) {
    for (const slot of ["primary", "secondary"]) {
      const window = entry?.[slot];
      if (!window || !Number.isFinite(window.usedPercent)) continue;
      const minutes = Number(window.windowDurationMins);
      const base = Number.isFinite(minutes) && minutes > 0 ? windowLabel(minutes) : `${slot} limit`;
      const scope = limitId === "codex" ? null : (entry.limitName ?? limitId);
      limits.push({
        id: `${limitId}-${slot}`,
        label: scope ? `${scope} · ${base}` : base,
        remaining: 100 - window.usedPercent,
        resetAt: Number.isFinite(window.resetsAt) ? isoOrNull(window.resetsAt * 1000) : null,
        windowMs: Number.isFinite(minutes) && minutes > 0 ? minutes * 60000 : null,
        ...(scope ? { group: scope } : {}),
      });
    }
  }
  if (!limits.length) throw fail("bad-output");
  return limits;
}

export async function read({ command = "codex" } = {}) {
  const result = await rpc(command, ["app-server"], async (session) => {
    await session.request("initialize", { clientInfo: { name: "capacity-collector", title: "Capacity collector", version: "1" } });
    session.notify("initialized", {});
    return session.request("account/rateLimits/read");
  });
  return parse(result);
}
