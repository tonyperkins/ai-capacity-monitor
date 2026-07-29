#!/usr/bin/env node

import crypto from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const configPath = process.env.CAPACITY_COLLECTOR_CONFIG
  ?? path.join(process.env.HOME ?? ".", ".config", "ai-capacity-monitor", "collector.json");
const command = process.argv[2] ?? "status";

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeConfig(config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await chmod(configPath, 0o600);
}

const config = await readConfig();

if (command === "enable") {
  const token = config.display?.token || crypto.randomBytes(32).toString("hex");
  config.display = {
    ...config.display,
    enabled: true,
    host: config.display?.host ?? "0.0.0.0",
    port: config.display?.port ?? 8788,
    token,
  };
  await writeConfig(config);
  console.log(`Display endpoint enabled on ${config.display.host}:${config.display.port}`);
  console.log(`Display token: ${token}`);
  console.log("Restart the local bridge to apply this change.");
} else if (command === "disable") {
  config.display = { ...config.display, enabled: false };
  await writeConfig(config);
  console.log("Display endpoint disabled. Its token was retained for future use.");
  console.log("Restart the local bridge to apply this change.");
} else if (command === "show-token") {
  if (!config.display?.token) {
    console.error("No display token has been configured. Run with 'enable' first.");
    process.exitCode = 1;
  } else {
    console.log(config.display.token);
  }
} else if (command === "status") {
  console.log(JSON.stringify({
    enabled: config.display?.enabled === true,
    host: config.display?.host ?? "0.0.0.0",
    port: config.display?.port ?? 8788,
    hasToken: Boolean(config.display?.token),
  }, null, 2));
} else {
  console.error("Usage: node configure-display.js [enable|disable|status|show-token]");
  process.exitCode = 1;
}
