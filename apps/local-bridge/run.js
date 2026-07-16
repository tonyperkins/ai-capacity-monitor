import http from "node:http";
import { readFile } from "node:fs/promises";

const configPath = process.env.CAPACITY_COLLECTOR_CONFIG ?? new URL("./config.local.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/collect") return response.writeHead(404).end();
  let raw = ""; for await (const chunk of request) raw += chunk;
  console.log(`Collection received: ${raw.length} bytes`);
  try {
    const upstream = await fetch(`${config.siteUrl}/api/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}`, "OAI-Sites-Authorization": `Bearer ${config.sitesBypassToken}` }, body: raw });
    const result = await upstream.text();
    console.log(`Collection delivery: ${upstream.status} ${result}`);
    response.writeHead(upstream.ok ? 202 : 502, { "content-type": "application/json" }).end(result);
  } catch (error) { console.error("Collection delivery failed:", error); response.writeHead(503).end("Collector cannot reach Capacity Monitor"); }
});
server.listen(8787, "127.0.0.1", () => console.log("Capacity Monitor collector listening on 127.0.0.1:8787"));
