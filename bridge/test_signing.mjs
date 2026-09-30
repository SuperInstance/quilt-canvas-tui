#!/usr/bin/env node
// test_signing.mjs — FAIL-first pins for the identity plane (PoEM door #1).
// Why signing at all: verifyChain (test_poem_gate) is tamper-EVIDENT but the
// rid rule is PUBLIC — an attacker who read fabric.mjs can rewrite a receipt
// and recompute every downstream rid, and the chain verifies clean.
// Tamper-evidence without a secret is a diary, not a ledger. HMAC-SHA256
// keyed by a secret that lives OUTSIDE the agent process is the difference:
// the rewriter cannot produce valid signatures for entries they forged.
// Pins:
//   S1 unsigned mode is a DECLARED state (ok:true, mode:"unsigned") — honest,
//     never a silent fail.
//   S2 with a signer set, every new receipt carries a 64-hex HMAC.
//   S3 the attack: rewrite a receipt, repair the chain by recomputing rids
//     (public rule) -> verifyChain PASSES (expected, stated), but
//     verifySignatures FAILS. This pin is the whole reason the plane exists.
//   S4 verification needs the same key; a wrong key is rejected loudly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Fabric, FIXED_6OP, applyScript } from "./fabric.mjs";
import { signerFromKey, verifySignatures } from "./signing.mjs";

const KEY = "test-key-that-lives-outside-the-process";

function fresh() {
  const f = new Fabric();
  applyScript(f, FIXED_6OP);
  return f;
}

test("S1 unsigned mode is declared, not silent", () => {
  const f = fresh();
  const v = verifySignatures(f.receipts, null);
  assert.equal(v.mode, "unsigned");
  assert.equal(v.ok, true, "unsigned must be a declared state, never a hidden fail");
  assert.equal(v.signed, 0);
});

test("S2 signer set -> every new receipt carries a 64-hex HMAC", () => {
  const f = fresh();
  f.setSigner(signerFromKey(KEY));
  f.bind("S1", [9]);
  const recs = f.receipts;
  assert.match(recs[recs.length - 1].sig, /^[0-9a-f]{64}$/);
  const v = verifySignatures(f.receipts, KEY);
  assert.equal(v.ok, true);
  assert.equal(v.signed, 1, "exactly the post-signer receipts are signed — no retro-backfill");
  // retro-sealed receipts (pre-signer) carry no sig and are reported, not failed
  assert.ok(v.unsigned >= FIXED_6OP.length - 1, "history before the signer is honestly reported unsigned");
});

test("S3 chain-repair attack: verifyChain passes, verifySignatures refuses", () => {
  const f = fresh();
  f.setSigner(signerFromKey(KEY));
  f.bind("S2", [1]);
  // attacker rewrites history AND repairs the chain using the PUBLIC rule
  // (anyone who has read fabric.mjs knows the preimage — no secret involved)
  f.receipts[1].result = { ...f.receipts[1].result, created: false };
  repairChain(f);
  const chain = f.verifyChain();
  assert.equal(chain.ok, true, "public-rule chain repair succeeds — that is the vulnerability");
  const sigs = verifySignatures(f.receipts, KEY);
  assert.equal(sigs.ok, false, "signatures must refuse the repaired forgery");
  assert.ok(sigs.bad.length >= 1);
});

test("S4 wrong key is rejected loudly", () => {
  const f = fresh();
  f.setSigner(signerFromKey(KEY));
  f.bind("S3", [2]);
  const v = verifySignatures(f.receipts, "attacker-key");
  assert.equal(v.ok, false);
});

// test-local: recompute rids with the same rule fabric._seal uses
import { createHash } from "node:crypto";
function repairChain(f) {
  const stable = (o) => {
    if (o === null || typeof o !== "object") return JSON.stringify(o);
    if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
    const keys = Object.keys(o).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
  };
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  for (let i = 0; i < f.receipts.length; i++) {
    const r = f.receipts[i];
    const parent = i === 0 ? null : f.receipts[i - 1].receipt_id;
    const rid = sha(stable({ op: r.op, addr: r.addr, result: r.result, parent })).slice(0, 16);
    r.parent = parent; r.receipt_id = rid;
  }
}
