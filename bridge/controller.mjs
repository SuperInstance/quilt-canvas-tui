#!/usr/bin/env node
// controller.mjs — the reference controller for the quilt-canvas bridge.
// This is the stand-in for an AGENT (claude-canvas paradigm): it owns the
// authoritative Fabric, applies opcode events the canvas emits, answers VIEW,
// and broadcasts update diffs. The canvas is a peer, not a display.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { Fabric, FIXED_6OP, applyScript } from "./fabric.mjs";

const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/default.sock";

const fabric = new Fabric();
applyScript(fabric, FIXED_6OP); // seed with the shared script so canvas sees a live fabric
const clients = new Set();

function broadcast(obj) {
  const line = JSON.stringify(obj) + "\n";
  for (const c of clients) c.write(line);
}

function summaryUpdate() {
  /* cells AND links — merging clients must rebuild the full fabric,
   * not just dial values, or their local EFFECT propagation diverges */
  const links = [];
  for (const c of fabric.cells.values())
    for (const n of c.neighbors)
      if (c.addr < n) links.push([c.addr, n]);
  return {
    type: "update",
    tick: fabric.tick,
    cells: [...fabric.cells.values()].map((c) => ({ addr: c.addr, dials: [...c.dials], kind: c.kind })),
    links,
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
        process.stderr.write(`[controller] canvas ready: pid=${msg.pid}\n`);
        conn.write(JSON.stringify({ type: "update", ...summaryUpdate(), hello: true }) + "\n");
      } else if (msg.type === "opcode") {
        const { op, cell, args } = msg;
        let r;
        if (op === "FORGET") r = fabric.forget(cell);
        else r = fabric.op(op, cell, args || {}).result;
        process.stderr.write(`[controller] opcode ${op} ${cell} -> ${JSON.stringify(r).slice(0, 90)}\n`);
        const upd = summaryUpdate();
        if (op === "VIEW" && r.cell) upd.inspector = r;
        broadcast(upd);
      } else if (msg.type === "selected") {
        process.stderr.write(`[controller] selected: ${JSON.stringify(msg.data)}\n`);
      } else if (msg.type === "cancelled") {
        process.stderr.write("[controller] canvas cancelled/quit\n");
      } else if (msg.type === "pong") {
        // liveness ack
      } else if (msg.type === "error") {
        process.stderr.write(`[controller] canvas error: ${msg.message}\n`);
      }
    }
  });
  conn.on("close", () => clients.delete(conn));
  conn.on("error", () => clients.delete(conn));
});

fs.mkdirSync(path.dirname(SOCK), { recursive: true });
try { fs.unlinkSync(SOCK); } catch {}
server.listen(SOCK, () => {
  process.stderr.write(`[controller] listening on ${SOCK} (localhost-only filesystem socket, no auth — design probe)\n`);
  process.stderr.write(`[controller] seeded fabric: tick=${fabric.tick} journal=${fabric.receipts.length} gdigest=${fabric.graphDigest()}\n`);
});

process.on("SIGINT", () => { broadcast({ type: "close" }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 200); });
