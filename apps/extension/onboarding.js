const $ = (id) => document.getElementById(id);
let selectedProvider = null;

function completeOnboarding() {
  chrome.storage.local.set({ onboardingCompleted: true });
  $("screen").innerHTML = `<p class="eyebrow">SETUP COMPLETE</p><h1>You're ready.</h1><p class="lead">Capacity Monitor will keep readings on this device. You can add more providers or configure optional publishing any time in Settings.</p><div class="actions"><button id="open-settings" type="button">Open settings</button><button id="close" class="subtle" type="button">Done</button></div>`;
  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("close").addEventListener("click", () => window.close());
}

function renderWelcome() {
  selectedProvider = null;
  $("screen").innerHTML = `<p class="eyebrow">WELCOME</p><h1>Know your available capacity.</h1><p class="lead">Capacity Monitor reads only the <strong>displayed balances and limits</strong> on provider pages you choose. It never asks for credentials, and nothing leaves this device unless you later configure publishing.</p><div class="notice">During collection, the extension uses its own pinned provider tabs so it does not reload pages you are using. You can choose to close those collection tabs and adjust the collection interval in Settings.</div><div class="actions"><button id="start" type="button">Set up a provider</button></div><p class="footnote">You can skip this and return anytime from Settings.</p>`;
  $("start").addEventListener("click", renderProviderList);
}

async function renderProviderList() {
  const { onboardingConfirmedProviders = [] } = await chrome.storage.local.get("onboardingConfirmedProviders");
  const configured = new Set(onboardingConfirmedProviders);
  const remaining = PROVIDERS.filter((provider) => !configured.has(provider.id));
  const heading = configured.size ? "Add another provider." : "Choose one provider to start.";
  const description = configured.size ? "Configured providers stay enabled. Choose another when you are ready." : "You can add the others later. Each provider gets its own site permission.";
  $("screen").innerHTML = `<p class="eyebrow">${configured.size ? "ADD PROVIDERS" : "STEP 1 OF 3"}</p><h1>${heading}</h1><p class="lead">${description}</p><div class="providers">${PROVIDERS.map((provider) => configured.has(provider.id) ? `<article class="provider configured"><div><strong>${provider.name}</strong><span>${provider.metrics.map((metric) => metric.label).join(" · ")}</span></div><span class="configured-label">Configured</span></article>` : `<article class="provider"><div><strong>${provider.name}</strong><span>${provider.metrics.map((metric) => metric.label).join(" · ")}</span></div><button data-provider="${provider.id}" type="button">Set up</button></article>`).join("")}</div>${remaining.length ? `<div class="actions"><button id="back" class="subtle" type="button">Back</button></div>` : `<div class="notice">All available providers are configured. You can adjust them any time in Settings.</div><div class="actions"><button id="finish" type="button">Finish setup</button></div>`}`;
  document.querySelectorAll("[data-provider]").forEach((button) => button.addEventListener("click", () => renderPermission(button.dataset.provider)));
  if ($("back")) $("back").addEventListener("click", renderWelcome);
  if ($("finish")) $("finish").addEventListener("click", completeOnboarding);
}

function renderPermission(providerId) {
  selectedProvider = PROVIDERS.find((provider) => provider.id === providerId);
  if (!selectedProvider) return renderProviderList();
  $("screen").innerHTML = `<p class="eyebrow">STEP 2 OF 3</p><h1>Allow ${selectedProvider.name} access.</h1><p class="lead">This lets Capacity Monitor read the displayed balance and limit values on <strong>${selectedProvider.hostname}</strong> while ${selectedProvider.name} is enabled.</p><div class="notice">Chrome will show its own permission prompt next. We do not see or request your sign-in details.</div><div class="actions"><button id="allow" type="button">Allow and open ${selectedProvider.name}</button><button id="back" class="subtle" type="button">Choose another</button></div>`;
  $("allow").addEventListener("click", enableAndOpenProvider);
  $("back").addEventListener("click", renderProviderList);
}

async function enableAndOpenProvider() {
  // This call is intentionally the first asynchronous action in the click
  // handler so Chrome recognizes it as the user's permission gesture.
  const granted = await chrome.permissions.request({ origins: [providerOrigin(selectedProvider)] });
  if (!granted) {
    $("screen").insertAdjacentHTML("beforeend", `<p class="notice error"><strong>Access was not granted.</strong> You can try again, choose another provider, or skip setup.</p>`);
    return;
  }
  const { enabledProviders = [] } = await chrome.storage.local.get("enabledProviders");
  await chrome.storage.local.set({ enabledProviders: [...new Set([...enabledProviders, selectedProvider.id])] });
  await chrome.tabs.create({ url: selectedProvider.url, active: true });
  renderCollectionPrompt();
}

function renderCollectionPrompt(message = "Return to this setup tab when you are finished, then check the displayed reading.") {
  $("screen").innerHTML = `<p class="eyebrow">STEP 3 OF 3</p><h1>Check your first reading.</h1><p class="lead">${message}</p><div class="notice"><strong>What to do next:</strong> the ${selectedProvider.name} page is open in another tab. Sign in there if needed, leave that tab open, then return here and select <strong>Check ${selectedProvider.name} now</strong>. The check may reload that provider page in the background.</div><div class="actions"><button id="check" type="button">Check ${selectedProvider.name} now</button><button id="back" class="subtle" type="button">Choose another provider</button></div>`;
  $("check").addEventListener("click", collectProvider);
  $("back").addEventListener("click", renderProviderList);
}

async function collectProvider() {
  const check = $("check");
  check.disabled = true;
  check.textContent = "Checking…";
  $("screen").insertAdjacentHTML("beforeend", `<p id="checking" class="notice">Checking ${selectedProvider.name} now. Stay on this tab; a result will appear here.</p>`);
  const result = await chrome.runtime.sendMessage({ type: "collect-provider", key: selectedProvider.metrics[0].key });
  const diagnostics = result?.diagnostics?.filter((entry) => entry.providerId === selectedProvider.id) ?? [];
  if (!result?.ok || diagnostics.some((entry) => entry.state === "unauthenticated")) return renderCollectionPrompt(`We could not read ${selectedProvider.name} yet. Sign in on its open page, return here, and try again. We only detect that a sign-in is needed; we never see your credentials.`);
  if (diagnostics.some((entry) => entry.state !== "validated")) return renderCollectionPrompt(`We could not read a value yet. Let ${selectedProvider.name} finish loading, keep its tab open, then try again.`);
  const { latestMetrics = [] } = await chrome.storage.local.get("latestMetrics");
  const readings = latestMetrics.filter((metric) => selectedProvider.metrics.some((definition) => definition.key === metric.key));
  if (!readings.length) return renderCollectionPrompt(`We could not find a displayed value yet. Check that ${selectedProvider.name} is signed in and fully loaded, then try again.`);
  renderConfirmation(readings);
}

function renderConfirmation(readings) {
  $("screen").innerHTML = `<p class="eyebrow">FIRST READING</p><h1>Does this look right?</h1><p class="lead">We found the following displayed value${readings.length === 1 ? "" : "s"} from ${selectedProvider.name}.</p><div class="result">${readings.map((metric) => `<strong>${metric.provider}: ${metric.display}</strong><span>${metric.label}</span>`).join("")}</div><div class="actions"><button id="finish" type="button">Yes, finish setup</button><button id="another" class="subtle" type="button">Yes, set up another provider</button><button id="retry" class="subtle" type="button">Try again</button></div>`;
  $("finish").addEventListener("click", confirmAndFinish);
  $("retry").addEventListener("click", () => renderCollectionPrompt(`Return to the open ${selectedProvider.name} tab if needed, then try again.`));
  $("another").addEventListener("click", confirmAndAddAnother);
}

async function confirmProvider() {
  const { onboardingConfirmedProviders = [] } = await chrome.storage.local.get("onboardingConfirmedProviders");
  await chrome.storage.local.set({ onboardingConfirmedProviders: [...new Set([...onboardingConfirmedProviders, selectedProvider.id])] });
}

async function confirmAndFinish() {
  await confirmProvider();
  completeOnboarding();
}

async function confirmAndAddAnother() {
  await confirmProvider();
  renderProviderList();
}

$("skip").addEventListener("click", completeOnboarding);
renderWelcome();
