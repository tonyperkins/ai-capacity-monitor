import { readFile } from "node:fs/promises";

// parseVisibleMetrics() is injected into provider pages via
// chrome.scripting.executeScript({ func: parseVisibleMetrics }) and is not
// an exported module — background.js is a classic (non-module) service
// worker script. Extracting its literal source text and evaluating it here
// tests the exact function that ships, without changing how the extension
// loads at runtime.
export async function loadParseVisibleMetrics() {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const marker = "function parseVisibleMetrics()";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("parseVisibleMetrics() not found in background.js — has it been renamed or moved?");
  const factory = new Function(`${source.slice(start)}\nreturn parseVisibleMetrics;`);
  return factory();
}

// A minimal DOM shim covering only what parseVisibleMetrics touches:
// element.children/.textContent/.parentElement/.innerText, plus
// document.querySelectorAll("*"). No jsdom dependency needed.
export class FakeElement {
  constructor({ children = [], textContent = "", innerText } = {}) {
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
}

function collectElements(root, out = []) {
  out.push(root);
  for (const child of root.children) collectElements(child, out);
  return out;
}

// Sets the globals parseVisibleMetrics reads. `dom`, if given, is an
// element tree used only for Kilo's card-lookup path (querySelectorAll);
// omitting it exercises the plain-text fallback parsing every other
// provider (and Kilo's fallback) relies on.
export function setPage({ hostname, text, dom = null }) {
  globalThis.location = { hostname };
  globalThis.document = {
    body: { innerText: text },
    querySelectorAll: (selector) => (selector === "*" && dom ? collectElements(dom) : []),
  };
}
