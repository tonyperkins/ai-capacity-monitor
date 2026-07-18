const $ = (id) => document.getElementById(id);
const stateText = { validated: "Validated", "suspicious-held": "Confirming change", "retained-prior": "Showing prior value", unauthenticated: "Sign in required", failed: "Reading unavailable" };
function renderProviders(enabledIds) {
  $("providers").innerHTML = PROVIDERS.map((provider) => `<label class="toggle"><input type="checkbox" data-provider="${provider.id}"${enabledIds.includes(provider.id) ? " checked" : ""}> <span>${provider.name}</span></label>`).join("");
}
function renderDiagnostics(enabledIds, metricStates) {
  const enabled = PROVIDERS.filter((provider) => enabledIds.includes(provider.id));
  if (!enabled.length) { $("diagnostics").textContent = "Enable a provider to see collection diagnostics."; return; }
  $("diagnostics").replaceChildren(...enabled.map((provider) => {
    const metrics = provider.metrics.map((metric) => ({ metric, diagnostic: metricStates[metric.key] })).filter((entry) => entry.diagnostic);
    const row = document.createElement("article");
    row.className = "diagnostic";
    const title = document.createElement("strong");
    title.textContent = provider.name;
    row.append(title);
    if (!metrics.length) {
      const detail = document.createElement("span");
      detail.textContent = "No collection attempt yet";
      row.append(detail);
      return row;
    }
    for (const { metric, diagnostic } of metrics) {
      const detail = document.createElement("span");
      const at = diagnostic.attemptedAt ? new Date(diagnostic.attemptedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown time";
      detail.textContent = `${metric.label}: ${stateText[diagnostic.state] ?? diagnostic.state} · ${diagnostic.errorCode ?? "ok"} · ${at}`;
      row.append(detail);
    }
    return row;
  }));
}
async function load() {
  const data = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes", "bridgeUrl", "bridgeSecret", "webhookUrl", "webhookAuthValue", "enabledProviders", "publishMode", "metricStates"]);
  $("auto-updates").checked = data.autoCollectionEnabled !== false;
  $("interval").value = data.collectionIntervalMinutes ?? 20;
  $("bridge-url").value = data.bridgeUrl ?? "";
  $("bridge-secret").value = data.bridgeSecret ?? "";
  $("webhook-url").value = data.webhookUrl ?? "";
  $("webhook-auth").value = data.webhookAuthValue ?? "";
  const mode = data.publishMode ?? "disabled";
  document.querySelectorAll("input[name=publish-mode]").forEach((input) => { input.checked = input.value === mode; });
  const enabled = data.enabledProviders ?? [];
  renderProviders(enabled);
  renderDiagnostics(enabled, data.metricStates ?? {});
}
$("save").addEventListener("click", async () => {
  const interval = Math.max(1, Math.min(1440, Number($("interval").value) || 20));
  $("interval").value = interval;
  const enabledProviders = [...document.querySelectorAll("#providers input:checked")].map((input) => input.dataset.provider);
  const publishMode = document.querySelector("input[name=publish-mode]:checked")?.value ?? "disabled";
  const bridgeUrl = $("bridge-url").value.trim();
  const webhookUrl = $("webhook-url").value.trim();
  const destination = publishMode === "bridge" ? (bridgeUrl || "http://127.0.0.1:8787/collect") : webhookUrl;
  const check = validateDestinationUrl(publishMode, destination);
  if (!check.ok) { $("publish-error").textContent = check.error; return; }
  $("publish-error").textContent = "";
  await chrome.storage.local.set({ autoCollectionEnabled: $("auto-updates").checked, collectionIntervalMinutes: interval, enabledProviders, publishMode, bridgeUrl, bridgeSecret: $("bridge-secret").value.trim(), webhookUrl, webhookAuthValue: $("webhook-auth").value.trim() });
  $("status").textContent = "Saved";
  setTimeout(() => { $("status").textContent = ""; }, 1800);
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.metricStates || changes.enabledProviders)) load(); });
load();
