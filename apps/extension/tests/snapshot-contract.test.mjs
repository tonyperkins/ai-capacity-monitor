import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile(new URL("../../../packages/contract/snapshot.v1.json", import.meta.url), "utf8"));
const statuses = schema.properties.metrics.items.properties.status.enum;
const states = schema.properties.metrics.items.properties.readState.enum;
const diagnosticStates = schema.properties.diagnostics.items.properties.state.enum;

test("snapshot v1 carries every explicit collection state", () => {
  const expected = ["validated", "suspicious-held", "retained-prior", "unauthenticated", "failed"];
  assert.deepEqual(statuses, ["verified", "unverified"]);
  assert.deepEqual(states, expected);
  assert.deepEqual(diagnosticStates, expected);
  assert.equal(schema.required.includes("diagnostics"), false, "diagnostics is additive for existing v1 consumers");
});
