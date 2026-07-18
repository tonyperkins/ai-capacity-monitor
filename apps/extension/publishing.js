// Publishing rules shared by the service worker (importScripts), the options
// page (script tag), and the tests (evaluated directly). Pure logic only — no
// chrome.* APIs here.

const PUBLISH_QUEUE_LIMIT = 10;
const PUBLISH_RETRY_BASE_MS = 30 * 1000;
const PUBLISH_RETRY_MAX_MS = 30 * 60 * 1000;

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

// Validates a destination URL for the given publish mode. The bridge must be
// loopback; a webhook must be HTTPS, with plain HTTP allowed only toward
// loopback (for testing a local receiver). Returns { ok } or { ok, error }.
function validateDestinationUrl(mode, raw) {
  if (mode === "disabled") return { ok: true };
  if (!raw || !raw.trim()) return { ok: false, error: "A destination URL is required." };
  let url;
  try { url = new URL(raw); } catch { return { ok: false, error: "The destination URL is not a valid URL." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "The destination must be an http(s) URL." };
  if (mode === "bridge" && !isLoopbackHost(url.hostname)) return { ok: false, error: "The local bridge must be a loopback address (127.0.0.1 or localhost)." };
  if (mode === "webhook" && url.protocol === "http:" && !isLoopbackHost(url.hostname)) return { ok: false, error: "A webhook must use HTTPS (plain HTTP is only allowed toward loopback)." };
  return { ok: true };
}

// Bounded exponential backoff with jitter: the delay for retry N is drawn
// from [base/2, base] where base = 30s * 2^(N-1), capped at 30 minutes.
function computePublishBackoffMs(retryCount, random = Math.random) {
  const base = Math.min(PUBLISH_RETRY_BASE_MS * 2 ** Math.max(0, retryCount - 1), PUBLISH_RETRY_MAX_MS);
  return Math.round(base / 2 + random() * (base / 2));
}
