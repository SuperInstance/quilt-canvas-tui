#!/usr/bin/env node
// test_poem_gate.mjs — FAIL-first pins for the PoEM gate on the fabric journal.
// PoEM (arXiv 2608.16032): a FARMA attacker writes forged "already done" claims
// into the memory the agent reads. Defense: don't inspect memory — keep a
// tamper-evident ledger of what ACTUALLY executed, writable only by the trusted
// action layer, and allow a step only if the ledger confirms real execution.
// Our mapping: canvas/projection == memory (untrusted, claim-shaped); the
// receipt chain == PoEM's ledger; fabric.op/gated == the trusted action layer.
// Pins: T1 clean chain verifies; T2 splice rejected; T3 result-edit rejected;
// T4 reorder rejected; T5 truncation rejected; T6 gated op refuses on tampered
// chain (and refuses are themselves receipted); T7 clean chain executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Fabric, FIXED_6OP, applyScript } from "./fabric.mjs";

function fresh() {
  const f = new Fabric();
  applyScript(f, FIXED_6OP);
  return f;
}

test("T1 verifyChain exists and a clean chain verifies", () => {
  const f = fresh();
  assert.equal(typeof f.verifyChain, "function", "fabric must expose verifyChain()");
  const v = f.verifyChain();
  assert.equal(v.ok, true, `clean chain must verify: ${JSON.stringify(v.violations)}`);
  assert.equal(v.checked, f.receipts.length);
  assert.ok(v.checked > 0, "the seeded script must produce receipts");
});

test("T2 spliced forged receipt is detected (FARMA: claim injected into memory)", () => {
  const f = fresh();
  // attacker inserts a fabricated "EFFECT already ran" entry mid-chain
  f.receipts.splice(2, 0, {
    schema: "quilt/cell-receipt@v1",
    receipt_id: "f".repeat(16),
    parent: f.receipts[1].receipt_id,
    op: "EFFECT", addr: "A1",
    result: { cell: "A1", propagated_to: ["ZZ"] },
    graph_digest: f.receipts[1].graph_digest,
    mutating: true, elapsed_ms: 0,
  });
  const v = f.verifyChain();
  assert.equal(v.ok, false);
  assert.ok(v.violations.length >= 1, "splice must be reported");
});

test("T3 edited result field breaks receipt_id (tamper-evidence)", () => {
  const f = fresh();
  f.receipts[1].result = { ...f.receipts[1].result, created: false }; // flip a verdict
  const v = f.verifyChain();
  assert.equal(v.ok, false, "edited result must fail rid recompute");
});

test("T4 reordered receipts break parent linkage", () => {
  const f = fresh();
  const tmp = f.receipts[1];
  f.receipts[1] = f.receipts[2];
  f.receipts[2] = tmp;
  const v = f.verifyChain();
  assert.equal(v.ok, false);
});

test("T5 truncated chain (dangling parent) is detected", () => {
  const f = fresh();
  f.receipts.pop(); // remove the tip; now the new tip's parent dangles... then
  // also corrupt: drop a MIDDLE receipt so a later parent points at nothing
  const f2 = fresh();
  f2.receipts.splice(1, 1);
  const v = f2.verifyChain();
  assert.equal(v.ok, false, "parent of receipt[1] must dangle after splice");
});

test("T6 gated op refuses on tampered chain and receipts the refusal", () => {
  const f = fresh();
  f.receipts[0].result = { forged: true };
  assert.equal(typeof f.gated, "function", "fabric must expose gated() PoEM gate");
  const before = f.cells.get("A1").version;
  const r = f.gated("EFFECT", "A1");
  assert.ok(r.error, "tampered chain must refuse execution");
  assert.match(r.error, /LEDGER_UNVERIFIED/);
  assert.equal(f.cells.get("A1").version, before, "refused op must not mutate state");
  const tip = f.receipts[f.receipts.length - 1];
  assert.equal(tip.op, "REFUSE", "the refusal itself must be receipted (execution, not narration)");
});

test("T7 clean chain executes through the gate", () => {
  const f = fresh();
  const r = f.gated("BIND", "Q1", { dials: [7, 7] });
  assert.ok(!r.error, `clean gated op must run: ${JSON.stringify(r)}`);
  assert.ok(f.cells.has("Q1"));
  assert.equal(f.receipts[f.receipts.length - 1].op, "BIND");
});
