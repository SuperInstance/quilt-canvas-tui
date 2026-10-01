#!/usr/bin/env node
// cudaclaw_board.mjs — mission-command board: CUDA-Claw GPU turn-taking lanes
// as quilt fabric cells. Client-mode board (canvas paradigm): controller.mjs
// owns the authoritative fabric; this board drives BIND/LINK/TICK opcodes into
// it over the unix socket, mirrors the same ops into a local Fabric, and logs
// every update broadcast that comes back. Real receipts as dials (uint32 per
// fabric law); links = real dependencies (every lane feeds the summary cell).
// Run: QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node cudaclaw_board.mjs
// Env: CUDA_CLAW_RECEIPTS — receipts.jsonl spool (default: quilt-gpu-lab cudaclaw run).
import net from "node:net";
import fs from "node:fs";
import { Fabric } from "./fabric.mjs";

const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/cudaclaw.sock";
const RECEIPTS =
  process.env.CUDA_CLAW_RECEIPTS ||
  "/home/eileen/projects/quilt-gpu-lab/results/cudaclaw_spool/receipts.jsonl";
const POLL_MS = 3000;
const SUMMARY_ADDR = "A5";
const KNOWN_MODELS = ["qwen3.5:0.8b", "tev1:0.8b", "qwen2.5:0.5b", "tev1:4b"]; // spool author's roster

const f = new Fabric(); // local mirror; the controller's fabric is authoritative

// ---- receipts -> lanes (first-appearance order; error turns COUNT as turns, not averaged) ----
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function readLanes() {
  let raw;
  try {
    raw = fs.readFileSync(RECEIPTS, "utf8");
  } catch {
    return null; // unreadable — caller warns FAIL-first and binds placeholders
  }
  const lanes = new Map();
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    let r;
    try {
      r = JSON.parse(ln);
    } catch {
      continue; // partial line mid-write; next poll re-reads
    }
    if (!r.model) continue;
    if (!lanes.has(r.model)) lanes.set(r.model, { turns: 0, tokS: [], spoolMs: [] });
    const L = lanes.get(r.model);
    L.turns++;
    if (!r.error) {
      if (Number.isFinite(r.tok_s)) L.tokS.push(r.tok_s);
      if (Number.isFinite(r.spool_ms)) L.spoolMs.push(r.spool_ms);
    }
  }
  return [...lanes.entries()].map(([model, L]) => ({
    model,
    kind: `spool:${model.replace(/:/g, "-")}`,
    dials: [L.turns, Math.round(avg(L.tokS) * 100), Math.round(avg(L.spoolMs) / 10)],
  }));
}

function placeholderCells() {
  return KNOWN_MODELS.map((m) => ({ model: m, kind: `spool:${m.replace(/:/g, "-")}`, dials: [0, 0, 0] }));
}

// lanes -> exactly 5 cells (A1..A4 lanes padded with zeros, A5 pooled summary)
function computeCells() {
  const lanes = readLanes();
  let cells;
  if (lanes === null || lanes.length === 0) {
    const why = lanes === null ? `unreadable at ${RECEIPTS}` : `empty at ${RECEIPTS}`;
    process.stderr.write(`[cudaclaw-board] FAIL: receipts ${why}; binding placeholder zero lanes and continuing\n`);
    cells = placeholderCells();
  } else {
    if (lanes.length > 4)
      process.stderr.write(`[cudaclaw-board] note: ${lanes.length} models in spool, binding first 4 (A1..A4)\n`);
    cells = lanes.slice(0, 4);
    while (cells.length < 4) {
      const m = KNOWN_MODELS[cells.length];
      cells.push({ model: m, kind: `spool:${m.replace(/:/g, "-")}`, dials: [0, 0, 0] });
    }
  }
  const pool = { turns: 0, tokS: [], spoolMs: [] };
  for (const c of cells) {
    pool.turns += c.dials[0];
    if (c.dials[1]) pool.tokS.push(c.dials[1] / 100);
    if (c.dials[2]) pool.spoolMs.push(c.dials[2] * 10);
  }
  cells.push({
    model: "summary",
    kind: "cudaclaw-board",
    dials: [pool.turns, Math.round(avg(pool.tokS) * 100), Math.round(avg(pool.spoolMs) / 10)],
  });
  return cells.map((c, i) => ({ addr: `A${i + 1}`, ...c }));
}

// ---- sync: apply ops locally, drive them into the controller ----
let sock = null;
let sentSig = "";

function send(obj) {
  if (sock) sock.write(JSON.stringify(obj) + "\n");
}

function sync(initial) {
  const cells = computeCells();
  const sig = JSON.stringify(cells.map((c) => c.dials));
  if (!initial && sig === sentSig) return; // spool unchanged; board stays quiet
  sentSig = sig;
  for (const c of cells) {
    f.bind(c.addr, c.dials, c.kind);
    send({ type: "opcode", op: "BIND", cell: c.addr, args: { dials: [...c.dials], kind: c.kind } });
  }
  for (let i = 1; i <= 4; i++) {
    f.link(`A${i}`, SUMMARY_ADDR);
    if (initial) send({ type: "opcode", op: "LINK", cell: "graph", args: { a: `A${i}`, b: SUMMARY_ADDR } });
  }
  f.doTick();
  send({ type: "opcode", op: "TICK", cell: "graph", args: {} });
  process.stderr.write(
    `[cudaclaw-board] ${initial ? "bound" : "re-bound"} lanes: ${cells
      .map((c) => `${c.addr}=${c.dials.join("/")}`)
      .join(" ")}\n`
  );
}

function connect() {
  const s = net.createConnection(SOCK);
  let buf = "";
  s.on("connect", () => {
    sock = s;
    process.stderr.write(`[cudaclaw-board] connected ${SOCK}\n`);
    s.write(JSON.stringify({ type: "ready", canvas: "cudaclaw-board", pid: process.pid }) + "\n");
    sync(true);
  });
  s.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const ln = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!ln.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(ln);
      } catch {
        continue;
      }
      if (msg.type === "update") {
        process.stderr.write(
          `[cudaclaw-board] update arrived: tick=${msg.tick} cells=${msg.cells?.length} links=${msg.links?.length} ledger_ok=${msg.ledger?.ok} tip=${msg.ledger?.tip}\n`
        );
      } else if (msg.type === "ping") {
        s.write(JSON.stringify({ type: "pong" }) + "\n");
      }
    }
  });
  s.on("error", (e) => {
    process.stderr.write(`[cudaclaw-board] socket error: ${e.code || e.message}; retrying in 2s\n`);
  });
  s.on("close", () => {
    sock = null;
    sentSig = ""; // full re-sync on reconnect
    setTimeout(connect, 2000);
  });
}

setInterval(() => sync(false), POLL_MS);
connect();
