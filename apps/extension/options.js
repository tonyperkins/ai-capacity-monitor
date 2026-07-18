const $=id=>document.getElementById(id);
function renderProviders(enabledIds){$("providers").innerHTML=PROVIDERS.map(p=>`<label class="toggle"><input type="checkbox" data-provider="${p.id}"${enabledIds.includes(p.id)?" checked":""}> <span>${p.name}</span></label>`).join("")}
async function load(){
  const data=await chrome.storage.local.get(["autoCollectionEnabled","collectionIntervalMinutes","bridgeUrl","bridgeSecret","webhookUrl","webhookAuthValue","enabledProviders","publishMode"]);
  $("auto-updates").checked=data.autoCollectionEnabled!==false;
  $("interval").value=data.collectionIntervalMinutes??20;
  $("bridge-url").value=data.bridgeUrl??"";
  $("bridge-secret").value=data.bridgeSecret??"";
  $("webhook-url").value=data.webhookUrl??"";
  $("webhook-auth").value=data.webhookAuthValue??"";
  const mode=data.publishMode??"disabled";
  document.querySelectorAll("input[name=publish-mode]").forEach(input=>{input.checked=input.value===mode});
  renderProviders(data.enabledProviders??[]);
}
$("save").addEventListener("click",async()=>{
  const interval=Math.max(1,Math.min(1440,Number($("interval").value)||20));
  $("interval").value=interval;
  const enabledProviders=[...document.querySelectorAll("#providers input:checked")].map(input=>input.dataset.provider);
  const publishMode=document.querySelector("input[name=publish-mode]:checked")?.value??"disabled";
  const bridgeUrl=$("bridge-url").value.trim();
  const webhookUrl=$("webhook-url").value.trim();
  const destination=publishMode==="bridge"?(bridgeUrl||"http://127.0.0.1:8787/collect"):webhookUrl;
  const check=validateDestinationUrl(publishMode,destination);
  if(!check.ok){$("publish-error").textContent=check.error;return}
  $("publish-error").textContent="";
  await chrome.storage.local.set({
    autoCollectionEnabled:$("auto-updates").checked,
    collectionIntervalMinutes:interval,
    enabledProviders,
    publishMode,
    bridgeUrl,
    bridgeSecret:$("bridge-secret").value.trim(),
    webhookUrl,
    webhookAuthValue:$("webhook-auth").value.trim(),
  });
  $("status").textContent="Saved";
  setTimeout(()=>{$("status").textContent=""},1800);
});
load();
