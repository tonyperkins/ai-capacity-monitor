const $ = (id) => document.getElementById(id);
const stateText = { validated: "Validated", "suspicious-held": "Confirming change", "retained-prior": "Showing prior value", unauthenticated: "Sign in required", "permission-needed": "Permission needed", failed: "Reading unavailable" };
let publishDestinationOrigin = null;

async function hasOriginPermission(origin) {
  return Boolean(origin) && chrome.permissions.contains({ origins: [origin] });
}

async function enabledProviderIds() {
  const { enabledProviders = [] } = await chrome.storage.local.get("enabledProviders");
  return enabledProviders;
}

async function setProviderEnabled(providerId, enabled) {
  const current = await enabledProviderIds();
  const next = enabled ? [...new Set([...current, providerId])] : current.filter((id) => id !== providerId);
  await chrome.storage.local.set({ enabledProviders: next });
  return next;
}

async function renderProviders(enabledIds = await enabledProviderIds()) {
  const permissions = await Promise.all(PROVIDERS.map(async (provider) => [provider.id, await hasOriginPermission(providerOrigin(provider))]));
  const accessByProvider = Object.fromEntries(permissions);
  $("providers").innerHTML = PROVIDERS.map((provider) => {
    const enabled = enabledIds.includes(provider.id);
    const granted = accessByProvider[provider.id];
    const access = granted ? (enabled ? "Access granted" : "Access retained while disabled") : "Permission needed";
    const action = granted ? "Remove access" : "Grant access";
    return `<article class="provider-option"><label class="toggle"><input type="checkbox" data-provider="${provider.id}"${enabled ? " checked" : ""}> <span>${provider.name}</span></label><span class="provider-access ${granted ? "granted" : "needed"}">${access}</span><button class="provider-permission" data-provider="${provider.id}" data-granted="${granted}" type="button">${action}</button></article>`;
  }).join("");
  $("providers").querySelectorAll("input[data-provider]").forEach((input) => input.addEventListener("change", () => toggleProvider(input)));
  $("providers").querySelectorAll("button[data-provider]").forEach((button) => button.addEventListener("click", () => changeProviderPermission(button.dataset.provider, button.dataset.granted === "true")));
}

async function requestProviderPermission(provider) {
  const message = `Allow Capacity Monitor to read the displayed balances and limits on ${provider.name}? It can only read this provider when you enable it.`;
  if (!window.confirm(message)) return false;
  return chrome.permissions.request({ origins: [providerOrigin(provider)] });
}

async function changeProviderPermission(providerId, granted) {
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId);
  if (!provider) return;
  const origin = providerOrigin(provider);
  if (granted) {
    if (window.confirm(`Remove Capacity Monitor's access to ${provider.name}? You can grant it again later in Settings.`)) await chrome.permissions.remove({ origins: [origin] });
  } else {
    await requestProviderPermission(provider);
  }
  renderProviders();
}

async function toggleProvider(input) {
  const provider = PROVIDERS.find((candidate) => candidate.id === input.dataset.provider);
  if (!provider) return;
  if (input.checked) {
    const granted = await requestProviderPermission(provider);
    if (!granted) {
      input.checked = false;
      $("status").textContent = `${provider.name}: permission was not granted`;
      return renderProviders();
    }
  }
  if (!input.checked && window.confirm(`Remove Capacity Monitor's access to ${provider.name} as well? You can keep access and re-enable this provider later without another prompt.`)) {
    await chrome.permissions.remove({ origins: [providerOrigin(provider)] });
  }
  await setProviderEnabled(provider.id, input.checked);
  $("status").textContent = input.checked ? `${provider.name} enabled` : `${provider.name} disabled`;
  renderProviders();
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
  const data = await chrome.storage.local.get(["autoCollectionEnabled", "collectionIntervalMinutes", "bridgeUrl", "bridgeSecret", "webhookUrl", "webhookAuthValue", "enabledProviders", "publishMode", "metricStates", "publishDestinationOrigin"]);
  $("auto-updates").checked = data.autoCollectionEnabled !== false;
  $("interval").value = data.collectionIntervalMinutes ?? 20;
  $("bridge-url").value = data.bridgeUrl ?? "";
  $("bridge-secret").value = data.bridgeSecret ?? "";
  $("webhook-url").value = data.webhookUrl ?? "";
  $("webhook-auth").value = data.webhookAuthValue ?? "";
  const mode = data.publishMode ?? "disabled";
  publishDestinationOrigin = data.publishDestinationOrigin ?? null;
  document.querySelectorAll("input[name=publish-mode]").forEach((input) => { input.checked = input.value === mode; });
  const enabled = data.enabledProviders ?? [];
  await renderProviders(enabled);
  renderDiagnostics(enabled, data.metricStates ?? {});
}

async function requestDestinationPermission(mode, destination) {
  if (mode === "disabled") return { ok: true, origin: null };
  const origin = originPatternForUrl(destination);
  if (!origin) return { ok: false, error: "Enter a valid publishing destination." };
  let label;
  try { label = new URL(destination).origin; } catch { return { ok: false, error: "Enter a valid publishing destination." }; }
  if (!window.confirm(`Allow Capacity Monitor to send validated snapshot data to ${label}? The destination never receives page content, cookies, or account identifiers.`)) return { ok: false, error: "Publishing permission was not granted." };
  const granted = await chrome.permissions.request({ origins: [origin] });
  return granted ? { ok: true, origin } : { ok: false, error: "Publishing permission was not granted." };
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
  const permission = await requestDestinationPermission(publishMode, destination);
  if (!permission.ok) { $("publish-error").textContent = permission.error; return; }
  if (publishMode === "disabled" && publishDestinationOrigin && window.confirm("Remove Capacity Monitor's access to the previous publishing destination?")) {
    await chrome.permissions.remove({ origins: [publishDestinationOrigin] });
    publishDestinationOrigin = null;
  }
  $("publish-error").textContent = "";
  publishDestinationOrigin = permission.origin ?? publishDestinationOrigin;
  await chrome.storage.local.set({ autoCollectionEnabled: $("auto-updates").checked, collectionIntervalMinutes: interval, enabledProviders, publishMode, bridgeUrl, bridgeSecret: $("bridge-secret").value.trim(), webhookUrl, webhookAuthValue: $("webhook-auth").value.trim(), publishDestinationOrigin });
  $("status").textContent = "Saved";
  setTimeout(() => { $("status").textContent = ""; }, 1800);
});

chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.metricStates || changes.enabledProviders)) load(); });
load();
