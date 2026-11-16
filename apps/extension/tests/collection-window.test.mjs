import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const tabFunctions = source.slice(source.indexOf("async function ensureCollectionTabs("), source.indexOf("async function refreshTabs("));
const windowFunctions = source.slice(source.indexOf("async function ensureCollectionWindowAnchor("));
const anchorUrl = "chrome-extension://test/collector.html";

function harness(data = {}) {
  const tabs = new Map();
  const events = [];
  let nextId = 10;
  let failCreateWindow = false;
  let nextWindowId = 99;
  const windows = new Set(Number.isInteger(data.collectionWindowId) ? [data.collectionWindowId] : []);
  const failures = { updateWindow: 0, removeWindow: false, providerCreate: false };
  const chrome = {
    runtime: { getURL: () => anchorUrl },
    storage: { local: { get: async () => data, set: async (patch) => Object.assign(data, patch) } },
    tabs: {
      create: async (props) => {
        events.push(["tab-create", props]);
        if (failures.providerCreate && props.url !== anchorUrl) throw new Error("Provider creation failed");
        const tab = { id: nextId++, windowId: 1, status: "loading", ...props };
        tabs.set(tab.id, tab);
        return tab;
      },
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("Tab closed");
        return tabs.get(id);
      },
      query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.windowId === windowId),
      update: async (id, props) => {
        events.push(["tab-update", id, props]);
        const tab = tabs.get(id);
        if (tab.failPin && props.pinned) throw new Error("Tab closed while pinning");
        Object.assign(tab, props);
        return tab;
      },
      move: async (id, { windowId }) => { tabs.get(id).windowId = windowId; },
    },
    windows: {
      get: async (id) => {
        if (!windows.has(id)) throw new Error("Window closed");
        return { id, state: "normal" };
      },
      update: async (id, props) => {
        events.push(["window-update", id, props]);
        if (failures.updateWindow > 0) { failures.updateWindow -= 1; throw new Error("Cannot update window"); }
      },
      create: async (props) => {
        events.push(["window-create", props]);
        assert.equal(tabs.get(props.tabId).title, "Capacity Monitor collector");
        assert.equal(tabs.get(props.tabId).status, "complete");
        if (failCreateWindow) throw new Error("Cannot create window");
        while (windows.has(nextWindowId)) nextWindowId += 1;
        const id = nextWindowId++;
        windows.add(id);
        tabs.get(props.tabId).windowId = id;
        return { id };
      },
      remove: async (id) => {
        events.push(["window-remove", id]);
        if (failures.removeWindow) throw new Error("Cannot close window");
        windows.delete(id);
        for (const [tabId, tab] of tabs) if (tab.windowId === id) tabs.delete(tabId);
      },
    },
  };
  const sleep = async () => {
    for (const tab of tabs.values()) {
      if (tab.url === anchorUrl) Object.assign(tab, { status: "complete", title: "Capacity Monitor collector" });
    }
  };
  const closeTabs = async (ids) => { for (const id of ids) tabs.delete(id); };
  const functions = new Function("chrome", "sleep", "closeTabs", `${tabFunctions}\n${windowFunctions}\nreturn { ensureCollectionWindow, ensureCollectionTabs };`)(chrome, sleep, closeTabs);
  return { ...functions, data, tabs, windows, failures, events, failCreate: () => { failCreateWindow = true; } };
}

test("loads a local anchor before mapping the window and creates provider tabs only there", async () => {
  const h = harness({ useCollectionWindow: true });
  const target = { id: "provider", url: "https://example.com/usage", match: "example.com" };
  const result = await h.ensureCollectionTabs([target]);
  assert.deepEqual(h.events[0], ["tab-create", { url: anchorUrl, active: false }]);
  assert.deepEqual(h.events[1], ["window-create", { tabId: 10, state: "minimized", focused: false }]);
  assert.equal(result.tabs[0].windowId, 99);
  assert.equal(result.tabs[0].active, false);
  assert.equal(result.tabs[0].pinned, true);
  assert.equal(h.tabs.get(10).url, anchorUrl);
  assert.equal(h.data.collectionWindowId, 99);
});

test("reuses the existing window and activates only its local anchor", async () => {
  const h = harness({ collectionWindowId: 99 });
  h.tabs.set(7, { id: 7, windowId: 99, url: anchorUrl });
  assert.deepEqual(await h.ensureCollectionWindow(), { id: 99 });
  assert.deepEqual(h.events, [
    ["tab-update", 7, { active: true }],
    ["window-update", 99, { state: "minimized" }],
  ]);
});

test("failed native-window creation removes the staged local tab", async () => {
  const h = harness();
  h.failCreate();
  await assert.rejects(h.ensureCollectionWindow(), /Cannot create window/);
  assert.equal(h.tabs.size, 0);
  assert.equal(h.data.collectionWindowId, undefined);
});

test("a failed pin operation cannot recreate a provider tab in the main window", async () => {
  const h = harness({ useCollectionWindow: true, collectionWindowId: 99, collectionTabIds: { provider: 8 } });
  h.tabs.set(7, { id: 7, windowId: 99, url: anchorUrl });
  h.tabs.set(8, { id: 8, windowId: 99, url: "https://example.com/usage", pinned: false, failPin: true });
  const result = await h.ensureCollectionTabs([{ id: "provider", url: "https://example.com/usage", match: "example.com" }]);
  assert.equal(result.tabs[0].windowId, h.data.collectionWindowId);
  assert.ok(h.events.some(([name, id]) => name === "window-remove" && id === 99));
  assert.equal(h.tabs.has(8), false);
  assert.equal(h.tabs.size, 2);
  assert.equal(h.data.collectionTabIds.provider, result.tabs[0].id);
});

const target = { id: "provider", url: "https://example.com/usage", match: "example.com/usage" };

function existingWindow() {
  const h = harness({ useCollectionWindow: true, collectionWindowId: 99, collectionTabIds: { provider: 8 } });
  h.tabs.set(7, { id: 7, windowId: 99, url: anchorUrl });
  h.tabs.set(8, { id: 8, windowId: 99, url: target.url, pinned: true });
  return h;
}

test("redirected owned tabs are reused across repeated collections without growth", async () => {
  const h = existingWindow();
  for (let i = 0; i < 10; i += 1) {
    h.tabs.get(8).url = "https://auth.example.com/login";
    const { tabs, opened } = await h.ensureCollectionTabs([target]);
    assert.equal(tabs[0].id, 8);
    assert.equal(tabs[0].url, target.url);
    assert.deepEqual(opened, []);
  }
  assert.equal(h.tabs.size, 2);
  assert.equal(h.events.filter(([name]) => name === "window-create").length, 0);
});

test("a bloated collection window is closed before replacement and stays bounded", async () => {
  const h = existingWindow();
  for (let id = 100; id < 130; id += 1) h.tabs.set(id, { id, windowId: 99, url: target.url });
  // A personal browser tab must survive resetting the dedicated window.
  h.tabs.set(200, { id: 200, windowId: 1, url: target.url });
  for (let i = 0; i < 10; i += 1) await h.ensureCollectionTabs([target]);
  const removed = h.events.findIndex(([name]) => name === "window-remove");
  const created = h.events.findIndex(([name]) => name === "window-create");
  assert.ok(removed >= 0 && created > removed);
  assert.equal(h.events.filter(([name]) => name === "window-create").length, 1);
  assert.equal(h.tabs.size, 3);
  assert.equal(h.tabs.has(200), true);
  assert.equal(h.windows.size, 1);
});

test("a missing tracked tab resets the entire dedicated window before collection", async () => {
  const h = existingWindow();
  h.tabs.delete(8);
  const { tabs } = await h.ensureCollectionTabs([target]);
  assert.ok(h.events.some(([name, id]) => name === "window-remove" && id === 99));
  assert.equal(tabs[0].windowId, h.data.collectionWindowId);
  assert.equal(h.tabs.size, 2);
});

test("failure to update an existing window closes it and clears stale tab IDs", async () => {
  const h = existingWindow();
  h.failures.updateWindow = 1;
  const { tabs } = await h.ensureCollectionTabs([target]);
  assert.equal(h.tabs.has(8), false);
  assert.equal(h.data.collectionTabIds.provider, tabs[0].id);
  assert.equal(h.tabs.size, 2);
  assert.equal(h.windows.size, 1);
  assert.ok(h.events.findIndex(([name]) => name === "window-remove") < h.events.findIndex(([name]) => name === "window-create"));
});

test("persistent provider creation failure closes each attempted window and stops after one recovery", async () => {
  const h = harness({ useCollectionWindow: true });
  h.failures.providerCreate = true;
  await assert.rejects(h.ensureCollectionTabs([target]), /Provider creation failed/);
  assert.equal(h.events.filter(([name]) => name === "window-create").length, 2);
  assert.equal(h.windows.size, 0);
  assert.equal(h.tabs.size, 0);
  assert.equal(h.data.collectionWindowId, null);
  assert.deepEqual(h.data.collectionTabIds, {});
});

test("failure to close a still-live window preserves ownership and prevents replacement", async () => {
  const h = existingWindow();
  h.failures.updateWindow = 1;
  h.failures.removeWindow = true;
  await assert.rejects(h.ensureCollectionTabs([target]), /Cannot close window/);
  assert.equal(h.events.filter(([name]) => name === "window-create").length, 0);
  assert.equal(h.data.collectionWindowId, 99);
  assert.deepEqual(h.data.collectionTabIds, { provider: 8 });
  assert.equal(h.tabs.size, 2);
});
