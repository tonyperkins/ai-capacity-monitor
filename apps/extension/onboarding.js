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
  $("screen").innerHTML = `<p class="eyebrow">WELCOME</p><h1>Know your available capacity.</h1><p class="lead">Capacity Monitor reads only the <strong>displayed balances and limits</strong> on provider pages you choose. It never asks for credentials, and nothing leaves this device unless you later configure publishing.</p><div class="notice">During collection, the extension may open or reload a provider page so its value is current. You can choose to close tabs it opened and adjust the collection interval in Settings.</div><div class="actions"><button id="start" type="button">Set up a provider</button></div><p class="footnote">You can skip this and return anytime from Settings.</p>`;
  $("start").addEventListener("click", renderProviderList);
}

function renderProviderList() {
  $("screen").innerHTML = `<p class="eyebrow">STEP 1 OF 3</p><h1>Choose one provider to start.</h1><p class="lead">You can add the others later. Each provider gets its own site permission.</p><div class="providers">${PROVIDERS.map((provider) => `<article class="provider"><div><strong>${provider.name}</strong><span>${provider.metrics.map((metric) => metric.label).join(" · ")}</span></div><button data-provider="${provider.id}" type="button">Set up</button></article>`).join("")}</div><div class="actions"><button id="back" class="subtle" type="button">Back</button></div>`;
  document.querySelectorAll("[data-provider]").forEach((button) => button.addEventListener("click", () => renderPermission(button.dataset.provider)));
  $("back").addEventListener("click", renderWelcome);
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

function renderCollectionPrompt(message = "Sign in on the provider page if needed, then check the displayed reading.") {
  $("screen").innerHTML = `<p class="eyebrow">STEP 3 OF 3</p><h1>Check your first reading.</h1><p class="lead">${message}</p><div class="notice">The provider page opened in a new tab. Sign-in happens there; Capacity Monitor never displays or asks for credentials.</div><div class="actions"><button id="check" type="button">Check ${selectedProvider.name} now</button><button id="back" class="subtle" type="button">Choose another provider</button></div>`;
  $("check").addEventListener("click", collectProvider);
  $("back").addEventListener("click", renderProviderList);
}

async function collectProvider() {
  const check = $("check");
  check.disabled = true;
  check.textContent = "Checking…";
  const result = await chrome.runtime.sendMessage({ type: "collect-provider", key: selectedProvider.metrics[0].key });
  const diagnostics = result?.diagnostics?.filter((entry) => entry.providerId === selectedProvider.id) ?? [];
  if (!result?.ok || diagnostics.some((entry) => entry.state === "unauthenticated")) return renderCollectionPrompt("Sign in on the provider page first, then try again. We only detect that a sign-in is needed; we never see your credentials.");
  if (diagnostics.some((entry) => entry.state !== "validated")) return renderCollectionPrompt("The reading is not ready yet. Let the provider page finish loading, then try again.");
  const { latestMetrics = [] } = await chrome.storage.local.get("latestMetrics");
  const readings = latestMetrics.filter((metric) => selectedProvider.metrics.some((definition) => definition.key === metric.key));
  if (!readings.length) return renderCollectionPrompt("No readable value was found yet. Check that the provider page is signed in and fully loaded, then try again.");
  renderConfirmation(readings);
}

function renderConfirmation(readings) {
  $("screen").innerHTML = `<p class="eyebrow">FIRST READING</p><h1>Does this look right?</h1><p class="lead">We found the following displayed value${readings.length === 1 ? "" : "s"} from ${selectedProvider.name}.</p><div class="result">${readings.map((metric) => `<strong>${metric.provider}: ${metric.display}</strong><span>${metric.label}</span>`).join("")}</div><div class="actions"><button id="correct" type="button">Yes, keep it</button><button id="retry" class="subtle" type="button">Try again</button><button id="another" class="subtle" type="button">Set up another provider</button></div>`;
  $("correct").addEventListener("click", completeOnboarding);
  $("retry").addEventListener("click", () => renderCollectionPrompt("We will reload the provider page and check again."));
  $("another").addEventListener("click", renderProviderList);
}

$("skip").addEventListener("click", completeOnboarding);
renderWelcome();
