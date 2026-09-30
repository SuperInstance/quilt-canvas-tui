#!/usr/bin/env node
// fleet_board.mjs — DOGFOOD controller: today's fire-wide lanes as a quilt fabric.
// Real receipts as dials (fractions x10000, uint32 per fabric law); links = real dependencies.
// Run: QUILT_SOCK=/home/eileen/tmp/quilt-fleet.sock node fleet_board.mjs
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { Fabric } from "./fabric.mjs";

const SOCK = process.env.QUILT_SOCK || "/home/eileen/tmp/quilt-fleet.sock";
const f = new Fabric();

// ---- bind: the lanes (grid addresses; kind carries semantics; dials = real receipts) ----
f.bind("A1", [4688, 9844], "mortar1-invalid-harness");      // control 0.4688
f.bind("B1", [10000, 2812, 2344, 9688], "mortar2-ORDER-CARRIES-LEANING"); // 1.0 / nulls .281 .234 / ampl .969
f.bind("C1", [200, 5550], "bridge-green-bug-booked");       // compile 200; re-pinch 0.555
f.bind("D1", [400, 8766], "lever-v0.4.0");
f.bind("E1", [3, 2, 0], "turbquant-running");               // 3 attempts, 2 fixes
f.bind("F1", [0], "c5-BLOCKED-no-videos");
f.bind("G1", [44, 23, 5, 14], "herd-14-unique");
f.bind("H1", [14, 8920], "si-api-14-tools");
f.bind("A2", [2, 5], "ideation-2-rounds");

// ---- link: real dependencies ----
for (const [a, b] of [
  ["A1", "B1"],             // mortar1 -> mortar2 lineage
  ["A2", "B1"],             // ideation seeded mortar2
  ["B1", "H1"],             // receipt booked to ledger
  ["C1", "D1"],             // bridge -> lever
  ["C1", "H1"],             // bridge -> si-api
  ["E1", "H1"],             // turbquant -> ledger embeddings
  ["G1", "H1"],             // herd -> bookings
]) f.link(a, b);

f.doTick();

const clients = new Set();
function summaryUpdate() {
  const links = [];
  for (const c of f.cells.values())
    for (const n of c.neighbors)
      if (c.addr < n) links.push([c.addr, n]);
  return {
    type: "update", tick: f.tick,
    cells: [...f.cells.values()].map((c) => ({ addr: c.addr, dials: [...c.dials], kind: c.kind })),
    links,
    gdigest: f.graphDigest(), journal: f.receipts.length,
  };
}

const server = net.createServer((conn) => {
  clients.add(conn);
  let buf = "";
  conn.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const ln = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!ln.trim()) continue;
      let msg;
      try { msg = JSON.parse(ln); } catch { continue; }
      if (msg.type === "ready") {
        conn.write(JSON.stringify({ type: "update", ...summaryUpdate(), hello: true }) + "\n");
      } else if (msg.type === "opcode") {
        const { op, cell, args } = msg;
        const r = op === "FORGET" ? f.forget(cell) : f.op(op, cell, args || {}).result;
        process.stderr.write(`[fleet-board] ${op} ${cell} -> ${JSON.stringify(r).slice(0, 90)}\n`);
        conn.write(JSON.stringify({ type: "update", ...summaryUpdate() }) + "\n");
      }
    }
  });
  conn.on("close", () => clients.delete(conn));
  conn.on("error", () => clients.delete(conn));
});

fs.mkdirSync(path.dirname(SOCK), { recursive: true });
try { fs.unlinkSync(SOCK); } catch {}
server.listen(SOCK, () => {
  process.stderr.write(`[fleet-board] ${f.cells.size} cells, ${f.receipts.length} receipts, gdigest=${f.graphDigest()} on ${SOCK}\n`);
});
