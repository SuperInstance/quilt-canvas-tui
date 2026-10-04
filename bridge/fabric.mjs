// fabric.mjs — the fabric model for the Node bridge.
// Semantics ported 1:1 from quilt-c's cell_api.py (the kernel reference):
// same canonical bytes, same FNV-1a 64 state hash, same receipt chain shape.
// Byte-compatibility is a TESTED property (see test_bridge.mjs), not a claim.
import { createHash } from "node:crypto";

export const OPS = ["BIND", "LINK", "EFFECT", "VIEW", "TICK"];

export function fnv1a64(bytes) {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b & 0xff);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function sha256hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function addrId(addr) {
  const d = createHash("sha256").update(addr, "utf8").digest();
  return d.subarray(0, 8).toString("hex"); // 8 bytes LE, hex form
}

export function canonicalBytes(cell) {
  const out = [1];
  const aid = addrId(cell.addr);
  for (let i = 0; i < 8; i++) out.push(parseInt(aid.substr(14 - i * 2, 2), 16));
  for (let i = 0; i < 8; i++) {
    const raw = i < cell.dials.length ? cell.dials[i] : 0;
    const d = Math.max(0, Math.min(0xffffffff, Number.isFinite(+raw) ? Math.trunc(+raw) : 0));
    out.push(d & 0xff, (d >>> 8) & 0xff, (d >>> 16) & 0xff, (d >>> 24) & 0xff);
  }
  const n = cell.neighbors.length;
  for (let i = 0; i < 8; i++) out.push((n >>> (i * 8)) & 0xff);
  for (const nb of cell.neighbors) {
    const nid = addrId(nb);
    for (let i = 0; i < 8; i++) out.push(parseInt(nid.substr(14 - i * 2, 2), 16));
  }
  return Buffer.from(out);
}

export function cellDigest(cell) {
  return fnv1a64(canonicalBytes(cell));
}

function stableStringify(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stableStringify).join(",") + "]";
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

const snapshot = (o) => (o === null || typeof o !== "object" ? o : JSON.parse(JSON.stringify(o)));

export class Fabric {
  constructor() {
    this.cells = new Map();
    this.tick = 0;
    this.receipts = [];
    this.violations = [];
    this._signer = null; // setSigner() installs the identity plane (signing.mjs)
  }

  setSigner(signer) { this._signer = signer; }

  graphDigest() {
    // python-faithful: cell_api.py graph_digest() uses f-string REPR, not
    // json.dumps — ints render [2, 1], strings render ['B1'] (single quotes).
    const pyArr = (a) => "[" + a.map((x) => (typeof x === "string" ? `'${x}'` : String(x))).join(", ") + "]";
    const parts = [];
    for (const addr of [...this.cells.keys()].sort()) {
      const c = this.cells.get(addr);
      parts.push(`${addr}|${c.kind}|${pyArr(c.dials)}|${pyArr([...c.neighbors].sort())}|v${c.version}`);
    }
    return sha256hex(parts.join(";") + `;tick=${this.tick}`).slice(0, 32);
  }

  op(op, addr, args = {}) {
    const t0 = Date.now();
    if (!OPS.includes(op)) {
      return this._seal(op, addr, { error: "UNKNOWN_OPCODE", detail: `op must be one of ${OPS}` }, args, t0);
    }
    let r;
    if (op === "BIND") r = this._bind(addr, args);
    else if (op === "LINK") r = this._link(addr, args);
    else if (op === "EFFECT") r = this._effect(addr, args);
    else if (op === "VIEW") r = this._view(addr, args);
    else r = this._tick(addr, args);
    return this._seal(op, addr, r, args, t0);
  }

  bind(addr, dials, kind = "generic") {
    const args = { dials: dials.slice() };
    if (kind !== "generic") args.kind = kind;
    return this.op("BIND", addr, args).result;
  }
  link(a, b) { return this.op("LINK", "graph", { a, b }).result; }
  effect(addr) { return this.op("EFFECT", addr).result; }
  view(addr) { return this.op("VIEW", addr).result; }
  doTick() { return this.op("TICK", "graph").result; }

  forget(addr) {
    const c = this.cells.get(addr);
    if (!c) return { error: "MISSING_CELL", detail: `no cell at ${addr}` };
    for (const n of [...c.neighbors]) {
      const nb = this.cells.get(n);
      if (nb && nb.neighbors.includes(addr)) {
        nb.neighbors.splice(nb.neighbors.indexOf(addr), 1);
        nb.version++;
      }
    }
    this.cells.delete(addr);
    // Seal through _seal() so ONE rid formula covers every entry. A local
    // formula here once diverged from _seal()'s preimage, and verifyChain()
    // — which recomputes via the _seal() formula — could never reproduce the
    // FORGET id, wedging the PoEM gate shut (LEDGER_UNVERIFIED on every
    // mutation until restart). Fixes #1.
    return this._seal("FORGET", addr, { cell: addr, forgotten: true }, {}, Date.now()).result;
  }

  _bind(addr, args) {
    const dials = (args.dials || []).map((d) => Math.max(0, Math.trunc(+d) || 0));
    const kind = args.kind || "generic";
    let c = this.cells.get(addr);
    if (!c) {
      c = { addr, kind, dials, neighbors: [], version: 1 };
      this.cells.set(addr, c);
      c.version_key = `1:${cellDigest(c)}`;
      return { cell: addr, dials: c.dials, version: 1, created: true };
    }
    const before = cellDigest(c);
    c.dials = dials;
    let versionBumped = false;
    if (cellDigest(c) !== before) { c.version++; versionBumped = true; }
    c.version_key = `${c.version}:${cellDigest(c)}`;
    return { cell: addr, dials: c.dials, version: c.version, created: false, bumped: versionBumped };
  }

  _link(addr, args) {
    const { a, b } = args;
    if (!this.cells.has(a) || !this.cells.has(b))
      return { error: "MISSING_CELL", detail: `LINK requires both cells bound; have ${[...this.cells.keys()].sort()}` };
    const ca = this.cells.get(a), cb = this.cells.get(b);
    if (!ca.neighbors.includes(b)) ca.neighbors.push(b);
    if (!cb.neighbors.includes(a)) cb.neighbors.push(a);
    ca.version++; cb.version++;
    ca.version_key = `${ca.version}:${cellDigest(ca)}`;
    cb.version_key = `${cb.version}:${cellDigest(cb)}`;
    return { edge: [a, b], a_neighbors: [...ca.neighbors], b_neighbors: [...cb.neighbors] };
  }

  _effect(addr, args) {
    const c = this.cells.get(addr);
    if (!c) return { error: "MISSING_CELL", detail: `no cell at ${addr}` };
    const propagated = [];
    for (const n of c.neighbors) {
      const nb = this.cells.get(n);
      if (!nb) continue;
      if (c.dials.length && nb.dials.length && nb.dials[0] !== c.dials[0]) {
        nb.dials[0] = c.dials[0];
        nb.version++;
        nb.version_key = `${nb.version}:${cellDigest(nb)}`;
        propagated.push(n);
      }
    }
    c.version++;
    c.version_key = `${c.version}:${cellDigest(c)}`;
    return { cell: addr, propagated_to: propagated };
  }

  _view(addr, args) {
    const c = this.cells.get(addr);
    if (!c) return { error: "MISSING_CELL", detail: `no cell at ${addr}` };
    const before = this.graphDigest();
    const view = { cell: addr, dials: [...c.dials], neighbors: [...c.neighbors], version: c.version, state_digest: cellDigest(c) };
    if (this.graphDigest() !== before) this.violations.push("VIEW_MUTATED_STATE");
    return view;
  }

  _tick(addr, args) {
    if (!(this.cells.has(addr) || addr === "graph" || addr === "" || addr == null))
      return { error: "MISSING_CELL", detail: `TICK takes the graph or an existing cell; ${addr} is neither` };
    const before = this.tick;
    this.tick++;
    for (const c of this.cells.values()) {
      c.dials = c.dials.map((d, i) => Math.max(0, d + (i % 2 === 0 ? 1 : -1)));
      c.version++;
      c.version_key = `${c.version}:${cellDigest(c)}`;
    }
    return { tick: this.tick, delta: this.tick - before, cells: this.cells.size };
  }

  _seal(op, addr, result, args, t0) {
    result = snapshot(result);
    args = snapshot(args);
    const parent = this.receipts.length ? this.receipts[this.receipts.length - 1].receipt_id : null;
    // PoEM discipline (arXiv 2608.16032): the ledger must be verifiable from
    // its OWN contents. The rid therefore binds only stored fields —
    // {op, addr, result, parent}. args are deliberately excluded from the
    // preimage (they are not stored on the receipt; result carries the
    // execution outcome, which is the testimony). A ledger whose ids bind
    // data it doesn't carry cannot detect edits to what it does carry —
    // an unverifiable ledger is FARMA-bait, not a defense.
    const raw = stableStringify({ op, addr, result, parent });
    const rid = sha256hex(raw).slice(0, 16);
    const rec = {
      schema: "quilt/cell-receipt@v1", receipt_id: rid, parent, op, addr, result,
      graph_digest: this.graphDigest(), mutating: ["BIND", "LINK", "EFFECT", "TICK", "FORGET"].includes(op),
      elapsed_ms: Date.now() - t0,
    };
    if (this._signer) rec.sig = this._signer.sign(rec); // identity plane: auth layered on the rid binding
    this.receipts.push(rec);
    return rec;
  }

  // PoEM gate (arXiv 2608.16032): the receipt chain is the tamper-evident
  // ledger of what ACTUALLY executed. verifyChain recomputes every rid from
  // the stored fields and walks parent linkage; a FARMA attacker can write
  // any claim into memory (the canvas/projection), but a spliced, edited,
  // reordered, or truncated entry breaks the chain and is named here.
  verifyChain() {
    const violations = [];
    for (let i = 0; i < this.receipts.length; i++) {
      const r = this.receipts[i];
      if (r.schema !== "quilt/cell-receipt@v1") {
        violations.push(`[${i}] schema ${JSON.stringify(r.schema)}`);
        continue;
      }
      const wantParent = i === 0 ? null : this.receipts[i - 1].receipt_id;
      if (r.parent !== wantParent) {
        violations.push(`[${i}] parent ${JSON.stringify(r.parent)} != ${JSON.stringify(wantParent)}`);
        continue;
      }
      const wantId = sha256hex(stableStringify({ op: r.op, addr: r.addr, result: r.result, parent: r.parent })).slice(0, 16);
      if (r.receipt_id !== wantId) {
        violations.push(`[${i}] receipt_id ${r.receipt_id} != recomputed ${wantId} (content edited?)`);
      }
    }
    return { ok: violations.length === 0, checked: this.receipts.length, violations };
  }

  // The gate: mutating steps execute only if the ledger confirms the chain is
  // intact. On tamper: refuse, mutate nothing, and RECEIPT THE REFUSAL —
  // the refusal is execution, not narration, so it belongs in the same chain.
  gated(op, addr, args = {}) {
    const v = this.verifyChain();
    if (!v.ok) {
      return this._seal("REFUSE", addr, {
        error: "LEDGER_UNVERIFIED",
        detail: v.violations[0],
        violations: v.violations.length,
      }, {}, Date.now()).result;
    }
    if (!OPS.includes(op)) {
      return this._seal(op, addr, { error: "UNKNOWN_OPCODE", detail: `op must be one of ${OPS}` }, args, Date.now()).result;
    }
    return this.op(op, addr, args).result;
  }
}

// ── shared test/demo script: the FIXED_6OP every lane byte-matches against ──
export const FIXED_6OP = [
  { op: "BIND", cell: "A1", dials: [1, 2] },
  { op: "BIND", cell: "B1", dials: [3] },
  { op: "LINK", a: "A1", b: "B1" },
  { op: "EFFECT", cell: "A1" },
  { op: "TICK" },
  { op: "VIEW", cell: "A1" },
];

export function applyScript(fabric, ops) {
  for (const op of ops) {
    const o = op.op;
    if (o === "BIND") fabric.bind(op.cell, op.dials || [], op.kind || "generic");
    else if (o === "LINK") fabric.link(op.a, op.b);
    else if (o === "EFFECT") fabric.effect(op.cell);
    else if (o === "VIEW") fabric.view(op.cell);
    else if (o === "TICK") fabric.doTick();
    else if (o === "FORGET") fabric.forget(op.cell);
    else fabric.op(o, op.cell || "graph", {});
  }
  return fabric;
}
