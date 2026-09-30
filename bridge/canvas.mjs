#!/usr/bin/env node
// canvas.mjs — the raw-ANSI spreadsheet canvas (no deps).
// claude-canvas paradigm, quilt-flavored: the canvas is a PEER. User keystrokes
// that are opcodes flow to the controller over the unix socket; controller
// updates flow back and re-render live. Offline mode (no socket) runs a local
// Fabric so the canvas is usable standalone.
// QUILT_HEADLESS=1 → line-based stdin script mode for tests (no TTY needed).
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Fabric, cellDigest, FIXED_6OP, applyScript } from "./fabric.mjs";
import { renderGrid } from "./chiaroscuro.mjs";

const HEADLESS = process.env.QUILT_HEADLESS === "1";
const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/default.sock";
const COLS = 8, ROWS = 6;

const addrOf = (c, r) => String.fromCharCode(65 + c) + (r + 1);
const rcOf = (a) => [a.charCodeAt(0) - 65, parseInt(a.slice(1), 10) - 1];

const state = {
  fabric: new Fabric(),
  cur: [0, 0],
  mode: "normal",          // normal | edit | link
  renderMode: "cells",     // cells | glyph | sculpt — L4 chiaroscuro projection
  editBuf: "",
  linkSrc: null,
  status: "arrows/hjkl move · e edit · L link · x effect · v view · t tick · d forget · g glyph · G sculpt · q quit",
  sock: null,
  online: false,
};

function send(obj) {
  if (state.online && state.sock) state.sock.write(JSON.stringify(obj) + "\n");
}

function applyLocally(op, addr, args = {}) {
  // optimistic local apply; controller update is authoritative when online
  return state.fabric.op(op, addr, args).result;
}

function mergeUpdate(msg) {
  if (msg.cells) for (const c of msg.cells) state.fabric.bind(c.addr, c.dials || [], c.kind || "generic");
  if (msg.links) for (const [a, b] of msg.links) {
    if (state.fabric.cells.has(a) && state.fabric.cells.has(b)) state.fabric.link(a, b);
  }
  if (typeof msg.tick === "number") state.fabric.tick = msg.tick;
  state.status = msg.inspector ? `VIEW ${msg.inspector.cell}: digest=${msg.inspector.state_digest}` : state.status;
}

// ── rendering ────────────────────────────────────────────────────────────────
function render() {
  if (HEADLESS) return;
  const CW = 10, CH = 3, OX = 2, OY = 2;
  let out = "\x1b[?1049h\x1b[?25l\x1b[H";
  if (state.needsClear) { out += "\x1b[2J"; state.needsClear = false; }
  const line = (y, x, s) => { out += `\x1b[${y};${x}H${s}`; };
  // grid — or the L4 chiaroscuro projection of the same fabric
  if (state.renderMode !== "cells") {
    const substrate = {
      tick: state.fabric.tick,
      cells: [...state.fabric.cells.values()].map((c) => ({ id: c.addr, dials: c.dials, links: c.neighbors || [] })),
      links: [],
    };
    const gridText = renderGrid(substrate, { cols: 32, rows: ROWS * CH - 2, engine: state.renderMode });
    line(OY, OX, `\x1b[2m─ chiaroscuro:${state.renderMode} — the fabric as substrate, one glyph per cell ─\x1b[0m`);
    gridText.split("\n").forEach((ln, i) => line(OY + 1 + i, OX, ln));
  } else {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const addr = addrOf(c, r);
      const cell = state.fabric.cells.get(addr);
      const sel = c === state.cur[0] && r === state.cur[1];
      const x = OX + c * CW, y = OY + r * CH;
      const d = cell ? cell.dials : [];
      const dialsS = "[" + d.slice(0, 3).join(",") + (d.length > 3 ? ",·" : "") + "]";
      const top = `${addr}`.padEnd(4) + `v${cell ? cell.version : 0}`.padEnd(CW - 5);
      line(y, x, (sel ? "\x1b[7m" : "") + top.slice(0, CW - 1) + (sel ? "\x1b[0m" : ""));
      line(y + 1, x, (sel ? "\x1b[7m" : "") + dialsS.padEnd(CW - 1).slice(0, CW - 1) + (sel ? "\x1b[0m" : ""));
    }
  }
  // edges (simple midpoint markers)
  for (const cell of state.fabric.cells.values()) {
    for (const n of cell.neighbors) {
      const [c0, r0] = rcOf(cell.addr), [c1, r1] = rcOf(n);
      if (c1 < c0 || (c1 === c0 && r1 < r0)) continue;
      const mx = OX + ((c0 + c1) / 2) * CW + 4, my = OY + ((r0 + r1) / 2) * CH + 1;
      line(my, mx, "\x1b[2m*\x1b[0m");
    }
  }
  }
  // status
  const [cc, cr] = state.cur;
  const caddr = addrOf(cc, cr);
  const ccell = state.fabric.cells.get(caddr);
  const left = ccell
    ? ` ${caddr} kind=${ccell.kind} v${ccell.version} digest=${cellDigest(ccell)} dials=${JSON.stringify(ccell.dials)}`
    : ` ${caddr} (empty)`;
  const meta = `tick=${state.fabric.tick} journal=${state.fabric.receipts.length} gdigest=${state.fabric.graphDigest()} ${state.online ? "ONLINE" : "offline"}`;
  const rows = process.stdout.rows || 24;
  line(rows - 2, 1, left.slice(0, process.stdout.columns || 80));
  line(rows - 1, 1, meta.slice(0, process.stdout.columns || 80));
  let st = " " + state.status;
  if (state.mode === "edit") st = ` BIND ${caddr} dials[,kind]> ${state.editBuf}`;
  if (state.mode === "link") st = state.linkSrc ? ` LINK ${state.linkSrc} → move to target, Enter` : " LINK: move to first endpoint, Enter";
  line(rows, 1, "\x1b[7m" + st.padEnd(process.stdout.columns || 80).slice(0, (process.stdout.columns || 80)) + "\x1b[0m");
  process.stdout.write(out);
}

function cleanupAndExit(code = 0) {
  if (!HEADLESS) process.stdout.write("\x1b[?25h\x1b[?1049l");
  console.log(`\nfinal gdigest=${state.fabric.graphDigest()} tick=${state.fabric.tick} journal=${state.fabric.receipts.length}`);
  process.exit(code);
}

// ── key handling ─────────────────────────────────────────────────────────────
function handleKey(key) {
  const [cc, cr] = state.cur;
  const caddr = addrOf(cc, cr);
  if (state.mode === "edit") {
    if (key === "ESC") { state.mode = "normal"; state.editBuf = ""; state.status = "edit cancelled"; }
    else if (key === "ENTER") {
      try {
        const parts = state.editBuf.split(",").map((s) => s.trim()).filter((s) => s !== "");
        let kind = "generic";
        if (parts.length && ["sum", "product", "max", "min"].includes(parts[parts.length - 1])) kind = parts.pop();
        const dials = parts.map((p) => parseInt(p, 10));
        if (dials.some(Number.isNaN)) throw new Error("nan");
        send({ type: "opcode", op: "BIND", cell: caddr, args: { dials, kind } });
        applyLocally("BIND", caddr, kind === "generic" ? { dials } : { dials, kind });
        state.status = `BOUND ${caddr}`;
      } catch { state.status = "parse error: ints, optional trailing kind"; }
      state.mode = "normal"; state.editBuf = "";
    } else if (key === "BACKSPACE") state.editBuf = state.editBuf.slice(0, -1);
    else if (key.length === 1) state.editBuf += key;
    return render();
  }
  if (state.mode === "link") {
    if (key === "ESC") { state.mode = "normal"; state.linkSrc = null; state.status = "link cancelled"; }
    else if (key === "ENTER") {
      if (!state.linkSrc) { state.linkSrc = caddr; state.status = `link from ${caddr}`; }
      else {
        const tgt = caddr;
        if (tgt !== state.linkSrc) {
          send({ type: "opcode", op: "LINK", cell: "graph", args: { a: state.linkSrc, b: tgt } });
          const r = applyLocally("LINK", "graph", { a: state.linkSrc, b: tgt });
          state.status = r.edge ? `LINK ${state.linkSrc}<->${tgt}` : `error ${r.detail || JSON.stringify(r)}`;
        }
        state.mode = "normal"; state.linkSrc = null;
      }
    } else move(key);
    return render();
  }
  switch (key) {
    case "g": state.renderMode = state.renderMode === "glyph" ? "cells" : "glyph"; state.needsClear = true; break;
    case "G": state.renderMode = state.renderMode === "sculpt" ? "cells" : "sculpt"; state.needsClear = true; break;
    case "q": case "ESC": send({ type: "cancelled" }); cleanupAndExit(0); break;
    case "LEFT": state.cur = [Math.max(0, cc - 1), cr]; break;
    case "RIGHT": state.cur = [Math.min(COLS - 1, cc + 1), cr]; break;
    case "UP": state.cur = [cc, Math.max(0, cr - 1)]; break;
    case "DOWN": state.cur = [cc, Math.min(ROWS - 1, cr + 1)]; break;
    case "h": state.cur = [Math.max(0, cc - 1), cr]; break;
    case "j": state.cur = [cc, Math.min(ROWS - 1, cr + 1)]; break;
    case "k": state.cur = [cc, Math.max(0, cr - 1)]; break;
    case "l": state.cur = [Math.min(COLS - 1, cc + 1), cr]; break;
    case "e": state.mode = "edit"; state.editBuf = ""; break;
    case "L": state.mode = "link"; state.linkSrc = null; break;
    case "x": {
      send({ type: "opcode", op: "EFFECT", cell: caddr });
      const r = applyLocally("EFFECT", caddr);
      state.status = `EFFECT → ${JSON.stringify(r.propagated_to || r)}`;
      break;
    }
    case "v": {
      send({ type: "opcode", op: "VIEW", cell: caddr });
      const r = applyLocally("VIEW", caddr);
      state.status = r.cell ? `VIEW ${r.cell} digest=${r.state_digest}` : `error ${r.detail}`;
      break;
    }
    case "t": {
      send({ type: "opcode", op: "TICK", cell: "graph" });
      const r = applyLocally("TICK", "graph");
      state.status = `TICK → ${r.tick}`;
      break;
    }
    case "d": {
      if (state.fabric.cells.has(caddr)) {
        send({ type: "opcode", op: "FORGET", cell: caddr });
        state.fabric.forget(caddr);
        state.status = `FORGET ${caddr}`;
      } else state.status = "nothing bound there";
      break;
    }
  }
  render();
}

function move(key) {
  const [cc, cr] = state.cur;
  if (key === "LEFT" || key === "h") state.cur = [Math.max(0, cc - 1), cr];
  else if (key === "RIGHT" || key === "l") state.cur = [Math.min(COLS - 1, cc + 1), cr];
  else if (key === "UP" || key === "k") state.cur = [cc, Math.max(0, cr - 1)];
  else if (key === "DOWN" || key === "j") state.cur = [cc, Math.min(ROWS - 1, cr + 1)];
}

// ── input: raw TTY or headless line script ───────────────────────────────────
function installInput() {
  if (HEADLESS) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (ln) => {
      const k = ln.trim();
      if (!k) return;
      if (k.length === 1) handleKey(k === "\t" ? "TAB" : k);
      else handleKey(k); // named keys: ENTER, ESC, LEFT..., or "e:1,2" compound
    });
    rl.on("close", () => cleanupAndExit(0));
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d.toString("utf8");
    while (buf.length) {
      if (buf[0] === "\x1b") {
        if (buf.length >= 3 && buf[1] === "[") {
          const m = { A: "UP", B: "DOWN", C: "RIGHT", D: "LEFT" }[buf[2]];
          if (m) { handleKey(m); buf = buf.slice(3); continue; }
        }
        handleKey("ESC"); buf = buf.slice(1); continue;
      }
      const ch = buf[0]; buf = buf.slice(1);
      if (ch === "\r" || ch === "\n") { handleKey("ENTER"); continue; }
      if (ch === "\x7f" || ch === "\b") { handleKey("BACKSPACE"); continue; }
      if (ch >= " ") handleKey(ch);
    }
  });
}

// ── socket ───────────────────────────────────────────────────────────────────
function connectSocket() {
  return new Promise((resolve) => {
    if (process.env.QUILT_OFFLINE === "1") return resolve(false);
    fs.mkdirSync(path.dirname(SOCK), { recursive: true });
    let attempts = 0;
    const tryOnce = () => {
      const s = net.createConnection(SOCK);
      const to = setTimeout(() => { s.destroy(); retry(); }, 800);
      const retry = () => {
        attempts++;
        if (attempts >= 6) return resolve(false); // ~5s of backoff, then offline
        setTimeout(tryOnce, 400);
      };
      s.on("connect", () => {
        clearTimeout(to);
        state.online = true; state.sock = s;
        s.write(JSON.stringify({ type: "ready", canvas: "sheet", pid: process.pid }) + "\n");
        s.on("data", (d) => {
          for (const ln of d.toString("utf8").split("\n")) {
            if (!ln.trim()) continue;
            let msg;
            try { msg = JSON.parse(ln); } catch { continue; }
            if (msg.type === "update") { mergeUpdate(msg); render(); }
            else if (msg.type === "close") cleanupAndExit(0);
            else if (msg.type === "ping") s.write(JSON.stringify({ type: "pong" }) + "\n");
          }
        });
        s.on("close", () => { state.online = false; state.sock = null; state.status = "controller gone — offline"; render(); });
        s.on("error", () => {});
        resolve(true);
      });
      s.on("error", () => { clearTimeout(to); retry(); });
    };
    tryOnce();
  });
}

async function main() {
  const fabricArg = process.argv.find((a) => a.startsWith("--fabric="));
  if (fabricArg) {
    const data = JSON.parse(fs.readFileSync(fabricArg.split("=")[1], "utf8"));
    applyScript(state.fabric, (data.cells || []).map((c) => ({ op: "BIND", cell: c.addr, dials: c.dials, kind: c.kind }))
      .concat((data.links || []).map(([a, b]) => ({ op: "LINK", a, b }))));
  }
  await connectSocket();
  installInput();
  render();
  if (HEADLESS && process.stdin.destroyed) cleanupAndExit(0);
}

main();
