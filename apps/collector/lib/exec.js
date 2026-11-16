import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// Vendor CLIs run from one dedicated empty folder so they pick up no project
// settings and leave no session files in real workspaces.
export const WORK_DIR = path.join(os.homedir(), ".cache", "ai-capacity-monitor", "cwd");

// Errors carry a short, safe `code`; raw CLI output never leaves a source.
export function fail(code) {
  return Object.assign(new Error(code), { code });
}

function start(command, args) {
  mkdirSync(WORK_DIR, { recursive: true });
  return spawn(command, args, { cwd: WORK_DIR, stdio: ["pipe", "pipe", "ignore"] });
}

// Run a command to completion and return its stdout.
export function run(command, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = start(command, args);
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(fail("timeout")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(fail(error.code === "ENOENT" ? "cli-not-found" : "spawn-failed")); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(fail(`exit-${code}`)); });
    child.stdin.end();
  });
}

// Talk JSON-RPC over a CLI's stdio (one JSON object per line), then stop it.
// `talk` receives { request, notify } and returns the value to resolve with.
export async function rpc(command, args, talk, { timeoutMs = 45000 } = {}) {
  const child = start(command, args);
  const pending = new Map();
  let nextId = 1;
  let rejectAll;
  const dead = new Promise((_, reject) => { rejectAll = reject; });
  dead.catch(() => {});
  const timer = setTimeout(() => rejectAll(fail("timeout")), timeoutMs);
  child.on("error", (error) => rejectAll(fail(error.code === "ENOENT" ? "cli-not-found" : "spawn-failed")));
  child.on("close", () => rejectAll(fail("cli-exited")));
  child.stdin.on("error", () => {});
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message?.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(fail("rpc-error")) : waiter.resolve(message.result);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const session = {
    notify: (method, params) => send({ method, ...(params === undefined ? {} : { params }) }),
    request: (method, params) => {
      const id = nextId++;
      const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      send({ id, method, ...(params === undefined ? {} : { params }) });
      return Promise.race([reply, dead]);
    },
  };
  try {
    return await Promise.race([talk(session), dead]);
  } finally {
    clearTimeout(timer);
    child.kill("SIGTERM");
  }
}
