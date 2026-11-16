// A source returns "limits": plain objects describing one quota line each.
//   { id, label, remaining, resetAt?, windowMs?, group?, parent? }
// `remaining` is percent left (0-100). Sources list whatever the provider
// reports, so lines that appear or disappear need no code change.

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Window length implied by a limit's own name, when the provider gives none.
export function inferWindowMs(text) {
  if (/5\s*-?\s*h|five\s*-?\s*hour|session/i.test(text)) return 5 * HOUR;
  if (/week/i.test(text)) return 7 * DAY;
  if (/dail|\bday\b|24\s*-?\s*h/i.test(text)) return DAY;
  if (/month/i.test(text)) return 30 * DAY;
  return null;
}

function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return value;
}

function offsetMs(instant, timeZone) {
  const v = wallClock(instant, timeZone);
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - instant;
}

// The instant at which `timeZone`'s wall clock reads the given date and time.
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - offsetMs(guess - offsetMs(guess, timeZone), timeZone);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Parses "Nov 21, 10am", "Nov 15, 11:09pm" or a bare "11:10pm" as the next
// such moment in `timeZone`. Returns an ISO string, or null if unreadable.
export function parseClockReset(text, timeZone, now = new Date()) {
  const match = /^(?:([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(String(text).trim());
  if (!match) return null;
  let hour = Number(match[3]) % 12;
  if (match[5].toLowerCase() === "pm") hour += 12;
  const minute = Number(match[4] ?? 0);
  let zone = timeZone;
  try { wallClock(now.getTime(), zone); } catch { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
  const today = wallClock(now.getTime(), zone);
  let instant;
  if (match[1]) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
    if (!month) return null;
    instant = zonedToUtc(today.year, month, Number(match[2]), hour, minute, zone);
    if (instant < now.getTime() - 12 * HOUR) instant = zonedToUtc(today.year + 1, month, Number(match[2]), hour, minute, zone);
  } else {
    instant = zonedToUtc(today.year, today.month, today.day, hour, minute, zone);
    if (instant <= now.getTime()) instant = zonedToUtc(today.year, today.month, today.day + 1, hour, minute, zone);
  }
  return new Date(instant).toISOString();
}

export function isoOrNull(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
