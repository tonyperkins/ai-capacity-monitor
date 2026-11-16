import { fail, run } from "../lib/exec.js";
import { inferWindowMs, isoOrNull, slug } from "../lib/limits.js";

export const id = "gemini";
export const name = "Gemini";

// `agy --print "/quota"` prints one tab-separated line per limit:
//   group <TAB> limit name <TAB> 91% <TAB> 2026-11-21T16:06:09Z
export function parse(text) {
  const limits = [];
  for (const line of String(text).split("\n")) {
    const [group, rawLabel, percent, reset] = line.split("\t").map((cell) => cell?.trim());
    const match = /^(\d+(?:\.\d+)?)%$/.exec(percent ?? "");
    if (!group || !rawLabel || !match) continue;
    // "Gemini 4 Argon / Gemini 4 Argon Weekly Limit" -> "Weekly Limit".
    let short = rawLabel.replace(/\s+remaining$/i, "");
    if (short.toLowerCase().startsWith(group.toLowerCase()) && short.length > group.length) short = short.slice(group.length).trim();
    limits.push({
      id: `${slug(group)}-${slug(short)}`,
      label: `${group} · ${short}`,
      remaining: Number(match[1]),
      resetAt: reset ? isoOrNull(reset) : null,
      windowMs: inferWindowMs(rawLabel),
      group,
    });
  }
  if (!limits.length) throw fail("bad-output");
  return limits;
}

export async function read({ command = "agy" } = {}) {
  return parse(await run(command, ["--print", "/quota", "--print-timeout", "45s"]));
}
