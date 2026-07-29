import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBridge, normalizeConfig } from "./bridge.js";

const configPath = process.env.CAPACITY_COLLECTOR_CONFIG ?? fileURLToPath(new URL("./config.local.json", import.meta.url));
const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
if (!rawConfig.collectorSecret) {
  rawConfig.collectorSecret = crypto.randomBytes(32).toString("hex");
  await writeFile(configPath, JSON.stringify(rawConfig, null, 2), { mode: 0o600 });
  console.log(`Generated a new collector secret. Paste this into the extension's Settings page (Local bridge secret):\n${rawConfig.collectorSecret}`);
}
if (rawConfig.display?.enabled && !rawConfig.display.token) {
  rawConfig.display.token = crypto.randomBytes(32).toString("hex");
  await writeFile(configPath, JSON.stringify(rawConfig, null, 2), { mode: 0o600 });
  console.log(`Generated a new read-only display token. Enter this in the CYD setup portal:\n${rawConfig.display.token}`);
}
const config = normalizeConfig(rawConfig, { configPath });
if (config.migratedLegacyDestination) {
  rawConfig.destination = config.destination;
  await writeFile(configPath, JSON.stringify(rawConfig, null, 2), { mode: 0o600 });
  console.log("Migrated legacy Sites forwarding settings to a generic webhook destination.");
}
const bridge = await createBridge({ config });
bridge.server.listen(8787, "127.0.0.1", () => console.log("Capacity Monitor bridge listening on 127.0.0.1:8787"));
if (bridge.displayServer) {
  bridge.displayServer.listen(config.display.port, config.display.host, () => console.log(`Read-only display endpoint listening on ${config.display.host}:${config.display.port}`));
}
