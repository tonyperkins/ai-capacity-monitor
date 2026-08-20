import { readFile } from "node:fs/promises";

// providers.js is a classic script (loaded via importScripts in the service
// worker and a <script> tag in the popup), not a module. Evaluating its
// literal source here tests the exact registry and engine that ship, without
// changing how the extension loads at runtime.
export async function loadProviders() {
  const source = await readFile(new URL("../providers.js", import.meta.url), "utf8");
  const factory = new Function(`${source}\nreturn { PROVIDERS, inspectProviderPage, readProviderMetrics };`);
  return factory();
}

// A minimal DOM shim covering only what readProviderMetrics touches:
// element.children/.textContent/.parentElement/.innerText, plus
// document.querySelectorAll("*"). No jsdom dependency needed.
export class FakeElement {
  constructor({ attributes = {}, children = [], textContent = "", innerText } = {}) {
    this.attributes = attributes;
    this.children = children;
    this.textContent = textContent;
    this._innerText = innerText;
    this.parentElement = null;
    for (const child of children) child.parentElement = this;
  }
  get innerText() {
    if (this._innerText !== undefined) return this._innerText;
    return this.children.length ? this.children.map((child) => child.innerText).join("\n") : this.textContent;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

function collectElements(root, out = []) {
  out.push(root);
  for (const child of root.children) collectElements(child, out);
  return out;
}

// Sets the globals readProviderMetrics reads. `dom`, if given, is an element
// tree used only by the labeled-card-money read type (querySelectorAll);
// omitting it exercises the plain-text parsing every other read type uses.
export function setPage({ hostname, href = `https://${hostname}/`, text, dom = null }) {
  globalThis.location = { hostname, href };
  globalThis.document = {
    body: { innerText: text },
    querySelectorAll: (selector) => (selector === "*" && dom ? collectElements(dom) : []),
  };
}
