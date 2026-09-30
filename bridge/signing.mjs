// signing.mjs — the identity plane (PoEM door #1) for the fabric journal.
// A hash chain is tamper-EVIDENT, but the rid rule is public: anyone who has
// read fabric.mjs can rewrite history and recompute every downstream rid.
// That is a diary, not a ledger. The difference between evidence and
// testimony-a-stranger-must-believe is a SECRET: HMAC-SHA256 keyed by material
// that lives OUTSIDE the agent's writable context (launcher env or a 0400
// keyfile the agent process can read but not write — candor's WAL owes the
// same discipline).
//
// Sig scope: HMAC over `${receipt_id}|${op}|${addr}|${parent}`. The rid already
// content-binds {op, addr, result, parent}; the sig authenticates that binding
// to whoever holds the key. sig is deliberately OUTSIDE the rid preimage —
// it is layered on top, like PoEM's HMAC over the executed-step entry.
import { createHmac } from "node:crypto";
import fs from "node:fs";

export function signerFromKey(key) {
  return {
    sign(rec) {
      return createHmac("sha256", key)
        .update(`${rec.receipt_id}|${rec.op}|${rec.addr}|${rec.parent}`)
        .digest("hex");
    },
  };
}

// Load the key from OUTSIDE the agent's writable context, in priority order:
//   1. QUILT_HMAC_KEY (set by the launcher, not the agent)
//   2. QUILT_KEYFILE (path to a file the agent can read but not write)
// Returns null when neither exists — unsigned is a DECLARED state (S1), not a
// silent failure. A fabric without a key is honest about it and signs nothing.
export function loadKeyFromEnv(env = process.env) {
  if (env.QUILT_HMAC_KEY) return env.QUILT_HMAC_KEY;
  if (env.QUILT_KEYFILE) {
    try {
      const st = fs.statSync(env.QUILT_KEYFILE);
      if (st.mode & 0o022) {
        process.stderr.write(`[signing] WARNING: keyfile ${env.QUILT_KEYFILE} is group/other-writable; refusing\n`);
        return null;
      }
      return fs.readFileSync(env.QUILT_KEYFILE, "utf8").trim();
    } catch { return null; }
  }
  return null;
}

export function verifySignatures(receipts, key) {
  if (!key) return { ok: true, mode: "unsigned", signed: 0, unsigned: receipts.length, bad: [] };
  const signer = signerFromKey(key);
  const bad = [];
  let signed = 0, unsigned = 0;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (!r.sig) { unsigned++; continue; }
    signed++;
    if (r.sig !== signer.sign(r)) bad.push(i);
  }
  return { ok: bad.length === 0, mode: "signed", signed, unsigned, bad };
}
