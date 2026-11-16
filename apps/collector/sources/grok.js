import { fail, rpc } from "../lib/exec.js";
import { isoOrNull } from "../lib/limits.js";

export const id = "grok";
export const name = "Grok";

const PERIOD_LABELS = { USAGE_PERIOD_TYPE_WEEKLY: "Weekly limit", USAGE_PERIOD_TYPE_MONTHLY: "Monthly limit", USAGE_PERIOD_TYPE_DAILY: "Daily limit" };

export function parse(result) {
  const config = result?.config;
  if (!config || !Number.isFinite(config.creditUsagePercent)) throw fail("bad-output");
  const start = Date.parse(config.currentPeriod?.start ?? config.billingPeriodStart ?? "");
  const end = Date.parse(config.currentPeriod?.end ?? config.billingPeriodEnd ?? "");
  const type = config.currentPeriod?.type ?? "";
  return [{
    id: type ? type.replace(/^USAGE_PERIOD_TYPE_/, "").toLowerCase() : "plan",
    label: PERIOD_LABELS[type] ?? "Plan limit",
    remaining: 100 - config.creditUsagePercent,
    resetAt: Number.isFinite(end) ? isoOrNull(end) : null,
    windowMs: Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null,
  }];
}

export async function read({ command = "grok" } = {}) {
  // The CLI's headless agent refreshes its own login and answers a billing
  // request without starting a conversation.
  const result = await rpc(command, ["agent", "stdio"], async (session) => {
    await session.request("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "capacity-collector", version: "1" } });
    return session.request("_x.ai/billing", {});
  });
  return parse(result);
}
