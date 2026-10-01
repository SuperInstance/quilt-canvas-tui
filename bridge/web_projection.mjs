#!/usr/bin/env node
// web_projection.mjs — browser projection of the mission-command workbench.
// The fleet captain watches the same quilt in a browser that agents watch in tmux.
// PEER, near-read-only: sends `ready` on the socket, plus exactly ONE explicit-write
// path — POST /dials (mixer faders) rebinds an EXISTING cell in place over the same
// wire BIND opcode the drawer chips use, and only on an explicit user click. Every
// other backend op is surfaced as a copy-paste chip; nothing auto-executes.
// Zero npm deps (node stdlib only).
// Three-panel workbench: LEFT "claw session" (agent chat thread + composer),
// MIDDLE superinstance view with sheet / pipeline / grid tabs,
// RIGHT context panel (per-cell frontends, code view, port popup).
// Run: PORT=8799 QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node bridge/web_projection.mjs
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { KIND_PORTS } from "./pipeline_view.mjs"; // single source of truth — the tmux mirror (pipeline_view.mjs) uses the same table

const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/cudaclaw.sock";
const BASE_PORT = parseInt(process.env.PORT || "8799", 10);
const FALLBACK_PORTS = [BASE_PORT, 8800, 8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808, 8809, 8810]
  .filter((p, i, a) => a.indexOf(p) === i);
const BOARD_FILE = path.join(import.meta.dirname, "cudaclaw_board.mjs"); // source-of-truth scan target
const QUESTIONS_FILE = "/tmp/canvas-web-questions.jsonl";
const ANSWERS_FILE = "/tmp/canvas-web-answers.jsonl";

// ---- port registry: imported from pipeline_view.mjs (see that file for the table) ----
// PROJECTION-LAYER display semantics only. The fabric itself is type-agnostic and
// stores links UNDIRECTED (mutual neighbors; wire order is addr-sorted, NOT flow
// direction) — this projection orients edges by port flow: if exactly one direction
// satisfies out(src) === in(dst), that is the drawn direction; otherwise wire order.
// Unknown kinds render as ? → ?. Link validation is visual only.

// ---- authoritative state, rebuilt from every `update` broadcast (never mutated locally) ----
const state = {
  connected: false,
  tick: null,
  cells: [],
  links: [],
  ledgerOk: null,
  ledgerTip: null, // msg.ledger?.tip ?? msg.gdigest — works for controller.mjs AND fleet_board.mjs
  updatedAt: null,
};

// ---- socket client: NDJSON peer with fixed 2s reconnect (cudaclaw_board idiom) ----
// FAIL-first: no socket file at startup is a loud exit, not a silent wait.
if (!fs.existsSync(SOCK)) {
  process.stderr.write(
    `[web-projection] FAIL: fabric socket missing at ${SOCK}\n` +
    `[web-projection] start the controller first (HARNESS.md §Driving it from tmux), or set QUILT_SOCK\n`
  );
  process.exit(1);
}

let sock = null;
const sseClients = new Set();

function handleUpdate(msg) {
  state.tick = msg.tick;
  if (Array.isArray(msg.cells)) state.cells = msg.cells;
  if (Array.isArray(msg.links)) state.links = msg.links;
  state.ledgerOk = msg.ledger ? msg.ledger.ok : null;
  state.ledgerTip = (msg.ledger && msg.ledger.tip) || msg.gdigest || null;
  state.updatedAt = new Date().toISOString();
  sseBroadcast({ type: "update", tick: state.tick, cells: state.cells, links: state.links,
    ledger: { ok: state.ledgerOk, tip: state.ledgerTip }, hello: !!msg.hello, at: state.updatedAt });
  process.stderr.write(
    `[web-projection] update: tick=${msg.tick} cells=${state.cells.length} links=${state.links.length} ` +
    `ledger_ok=${state.ledgerOk} tip=${String(state.ledgerTip).slice(0, 12)}\n`
  );
}

function connect() {
  const s = net.createConnection(SOCK);
  let buf = "";
  s.on("connect", () => {
    sock = s;
    state.connected = true;
    process.stderr.write(`[web-projection] connected ${SOCK} (peer: read-only, sends ready only)\n`);
    s.write(JSON.stringify({ type: "ready", canvas: "web-projection", pid: process.pid }) + "\n");
  });
  s.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const ln = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!ln.trim()) continue;
      let msg;
      try { msg = JSON.parse(ln); } catch { continue; }
      if (msg.type === "update") handleUpdate(msg);
      else if (msg.type === "ping") s.write(JSON.stringify({ type: "pong" }) + "\n");
    }
  });
  s.on("error", (e) => {
    process.stderr.write(`[web-projection] socket error: ${e.code || e.message}; retrying in 2s\n`);
  });
  s.on("close", () => {
    sock = null;
    state.connected = false;
    setTimeout(connect, 2000); // same fixed backoff the board uses; full state re-syncs via hello update
  });
}
connect();

// ---- source scan: honest excerpt from the board file (bind line ±2), or an explicit null ----
function findSourceExcerpt(addr) {
  let raw;
  try { raw = fs.readFileSync(BOARD_FILE, "utf8"); } catch (e) {
    return { found: false, reason: `board file unreadable: ${e.code || e.message}` };
  }
  const lines = raw.split("\n");
  const esc = addr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // tightest first: an actual bind/link call on this literal addr; then any quoted occurrence
  const patterns = [
    new RegExp(`\\b(bind|link)\\s*\\(\\s*["'\`]${esc}["'\`]`),
    new RegExp(`["'\`]${esc}["'\`]`),
  ];
  for (const re of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        return { found: true, line: i + 1, excerpt: lines.slice(Math.max(0, i - 2), i + 3).join("\n") };
      }
    }
  }
  return { found: false, reason: "no bind line found" };
}

// ---- code view: name-KEYED whitelist (NO path params — traversal-impossible by
// construction: each key maps to a fixed file + a line range found by regex markers
// once, then cached). "ports" points at pipeline_view.mjs because that is where the
// KIND_PORTS table web_projection imports actually lives (single source of truth,
// shared with the tmux mirror).
const SOURCE_SECTIONS = {
  ports: {
    file: path.join(import.meta.dirname, "pipeline_view.mjs"),
    label: "KIND_PORTS registry (imported by web_projection)",
    start: /^\/\/ ---- port registry/,
    mid: /^export const KIND_PORTS = \{/,
    end: /^\}/, // first 0-indent closing brace AFTER the mid marker
  },
  ops: {
    file: path.join(import.meta.dirname, "op.mjs"),
    label: "op.mjs — wire contract + opcode socket turn",
    start: /^\/\/ op\.mjs/,
    mid: /^function socketTurn/,
    end: /^\}/,
  },
  builder: {
    file: path.join(import.meta.dirname, "builder.mjs"),
    label: "builder.mjs — ALLOWED_OPS whitelist + validator + executor",
    start: /^const ALLOWED_OPS/,
    end: /^\/\/ ---------- LLM/, // exclusive stop
  },
};
const sourceCache = new Map();
function sourceSection(key) {
  if (sourceCache.has(key)) return sourceCache.get(key);
  const spec = SOURCE_SECTIONS[key];
  if (!spec) return null;
  let out = null;
  try {
    const lines = fs.readFileSync(spec.file, "utf8").split("\n");
    const from = lines.findIndex((l) => spec.start.test(l));
    if (from >= 0) {
      let stop = -1; // exclusive 0-based end of the included range
      if (spec.mid) {
        const m = lines.findIndex((l, i) => i > from && spec.mid.test(l));
        if (m >= 0) {
          const e = lines.findIndex((l, i) => i > m && spec.end.test(l));
          if (e >= 0) stop = e + 1; // include the closing brace line
        }
      } else {
        const e = lines.findIndex((l, i) => i > from && spec.end.test(l));
        if (e >= 0) stop = e; // stop line itself excluded
      }
      if (stop > from) {
        while (stop > from && !lines[stop - 1].trim()) stop--; // trim trailing blanks
        out = { path: spec.file, from_line: from + 1, to_line: stop, text: lines.slice(from, stop).join("\n"), label: spec.label };
      }
    }
  } catch { out = null; }
  sourceCache.set(key, out);
  return out;
}

// ---- explicit-write socket turn (op.mjs idiom): fresh connection, one wire opcode,
// resolve on the controller's post-opcode broadcast. Used ONLY by POST /dials.
// No `ready` is sent (mirrors op.mjs — the controller answers opcodes on any
// connection; a hello update only goes to peers that announce ready).
function sendOpcode(wire, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK);
    let buf = "";
    const fail = (e) => { try { s.destroy(); } catch { /* already gone */ } reject(e); };
    const timer = setTimeout(() => fail(new Error(`no update within ${timeoutMs}ms`)), timeoutMs);
    s.on("connect", () => s.write(JSON.stringify(wire) + "\n"));
    s.on("error", fail);
    s.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(ln); } catch { continue; }
        if (m.type === "update") { clearTimeout(timer); try { s.destroy(); } catch { /* gone */ } resolve(m); return; }
      }
    });
  });
}

// ---- ask/inbox: the captain's non-interrupting channel. /ask NEVER touches the socket. ----
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}
function readJsonl(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try { out.push(JSON.parse(ln)); } catch { continue; } // partial line mid-write; next read wins
  }
  return out;
}

function inbox() {
  // dedupe by ts (re-seeded lines rendered as ghost "unanswered" copies)
  const seenTs = new Set();
  const questions = readJsonl(QUESTIONS_FILE)
    .filter((q) => (seenTs.has(q.ts) ? false : (seenTs.add(q.ts), true)))
    .map((q, index) => ({ index, ...q, replies: [] }));
  const unmatched = [];
  for (const r of readJsonl(ANSWERS_FILE)) {
    const byTs = questions.find((q) => r.ts === q.ts || r.qts === q.ts || r.question_ts === q.ts);
    const byIndex = !byTs && Number.isInteger(r.index) ? questions[r.index] : null;
    const q = byTs || byIndex;
    if (q) q.replies.push(r);
    else unmatched.push(r);
  }
  for (const q of questions) q.answered = q.replies.length > 0; // live truth; file keeps ask-time state
  return { questions, unmatched_replies: unmatched };
}

// ---- JSONL-driven chips: exact copy-paste backend commands, per HARNESS gotcha #2 ----
function shellSafe(s) { return String(s).replace(/'/g, `'\\''`); }
function chipCommand(ndjson) {
  const body =
    `const net=require("net");const s=net.createConnection(${JSON.stringify(SOCK)});` +
    `s.on("connect",()=>s.write(require("fs").readFileSync(0,"utf8")));` +
    `s.on("data",(d)=>process.stdout.write(d));`;
  return `echo '${shellSafe(JSON.stringify(ndjson))}' | timeout 2 node -e '${body}'`;
}

// ---- HTTP ----
function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2) + "\n";
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function sseBroadcast(obj) {
  const frame = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of sseClients) { try { c.write(frame); } catch { sseClients.delete(c); } }
}
setInterval(() => { for (const c of sseClients) { try { c.write(`: hb\n\n`); } catch { sseClients.delete(c); } } }, 15000);

function page() {
  const sockJson = JSON.stringify(SOCK);
  const portsJson = JSON.stringify(KIND_PORTS);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quilt — three-panel workbench (cudaclaw)</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --edge:#30363d; --ink:#c9d1d9; --dim:#8b949e;
          --acc:#58a6ff; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --chip:#21262d; }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;
         display:flex; flex-direction:column; overflow:hidden; }
  header { display:flex; flex-wrap:wrap; gap:10px 22px; align-items:baseline; padding:10px 16px;
           border-bottom:1px solid var(--edge); background:var(--panel); flex:0 0 auto; }
  header h1 { font-size:15px; margin:0; color:var(--acc); }
  .kv { color:var(--dim); } .kv b { color:var(--ink); font-weight:600; }
  #dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--warn); margin-right:5px; }
  #dot.on { background:var(--ok); }
  .banner { padding:7px 16px; background:#202a3a; border-bottom:1px solid var(--edge); color:#a5c8ff; flex:0 0 auto; }
  .modes { padding:6px 16px; display:flex; gap:8px; align-items:center; color:var(--dim);
           border-bottom:1px solid var(--edge); flex:0 0 auto; }
  .modes button { background:var(--chip); color:var(--ink); border:1px solid var(--edge); border-radius:6px;
                  padding:3px 12px; cursor:pointer; font:inherit; }
  .modes button.on { border-color:var(--acc); color:var(--acc); }
  main { flex:1; min-height:0; display:grid; grid-template-columns:280px 1fr 340px; }
  main.ctxmin { grid-template-columns:280px 1fr 34px; }
  /* ---------- LEFT: claw session ---------- */
  #claw { min-width:0; display:flex; flex-direction:column; min-height:0;
          border-right:1px solid var(--edge); background:#10151c; }
  #claw h2, .tabs h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0; }
  #claw > h2 { padding:10px 14px; border-bottom:1px solid var(--edge); }
  #thread { flex:1; overflow-y:auto; padding:12px 14px; }
  .msg { margin:0 0 12px; }
  .msg .from { font-weight:700; margin-right:8px; }
  .msg.user .from { color:var(--acc); }
  .msg.op .from.builder { color:var(--ok); }
  .msg.op .from.lucineer { color:var(--acc); }
  .msg.op .from.operator { color:var(--dim); }
  .msg .t { font-size:11px; }
  .msg .body { margin-top:3px; white-space:pre-wrap; word-break:break-word; }
  .msg.user { border-left:2px solid var(--acc); padding:2px 0 2px 10px; }
  .msg.user.await { border-left-color:var(--warn); background:#d299220d; }
  .msg.op { border-left:2px solid var(--ok); padding:2px 0 2px 10px; }
  .awaiting { color:var(--warn); font-size:11px; margin-top:4px; }
  .qref { font-size:11px; margin-top:3px; }
  .opchip { display:inline-block; background:var(--chip); border:1px dashed var(--warn); border-radius:10px;
            padding:1px 8px; font-size:11px; margin:6px 6px 0 0; cursor:pointer; color:var(--ink); }
  .opchip:hover { border-color:var(--acc); color:var(--acc); }
  .mut { color:var(--dim); }
  .empty { margin-top:20px; }
  #composer { border-top:1px solid var(--edge); padding:10px 14px; flex:0 0 auto; }
  textarea { width:100%; background:#0a0d12; color:var(--ink); border:1px solid var(--edge);
             border-radius:6px; padding:8px; font:inherit; min-height:56px; resize:vertical; }
  .crow { margin-top:6px; display:flex; gap:10px; align-items:center; }
  button.act { background:var(--chip); color:var(--ink); border:1px solid var(--edge); border-radius:6px;
               padding:5px 14px; cursor:pointer; font:inherit; }
  button.act:hover { border-color:var(--acc); }
  /* ---------- RIGHT: superinstance view ---------- */
  #super { min-width:0; display:flex; flex-direction:column; min-height:0; }
  .tabs { display:flex; gap:8px; align-items:center; padding:8px 16px; border-bottom:1px solid var(--edge);
          flex:0 0 auto; background:var(--panel); }
  .tabs button { background:var(--chip); color:var(--ink); border:1px solid var(--edge); border-radius:6px;
                 padding:4px 16px; cursor:pointer; font:inherit; }
  .tabs button.on { border-color:var(--acc); color:var(--acc); }
  .tabs .mut { margin-left:auto; font-size:11px; }
  .tab { display:none; flex:1; min-height:0; overflow:auto; padding:16px; }
  .tab.on { display:block; }
  .hl { outline:2px solid var(--warn) !important; box-shadow:0 0 12px #d2992244; }
  /* sheet */
  #sheet { border-collapse:collapse; }
  #sheet th, #sheet td { border:1px solid var(--edge); padding:6px 10px; text-align:left; vertical-align:top; }
  #sheet th { background:var(--panel); cursor:pointer; user-select:none; color:var(--dim);
              position:sticky; top:-16px; white-space:nowrap; }
  #sheet th:hover { color:var(--acc); }
  #sheet tbody tr { cursor:pointer; }
  #sheet tbody tr:hover { background:#1a2129; }
  #sheet tbody tr.sel { outline:1px solid var(--acc); }
  #sheet .addr { color:var(--acc); font-weight:700; }
  #sheet td.ports.unk, #sheet td.kind.unk { color:var(--dim); }
  #sheet .lkout { white-space:nowrap; margin-right:8px; }
  .lk.ok, .parr.ok, .arrow.ok { color:var(--ok); }
  .lk.bad, .parr.bad, .arrow.bad { color:var(--bad); }
  .lk.unk, .parr.unk, .arrow.unk { color:var(--dim); }
  .badge { color:var(--bad); border:1px solid var(--bad); border-radius:3px; font-size:10px;
           padding:0 4px; margin-left:6px; white-space:nowrap; }
  /* pipeline */
  .chainlabel { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em; margin:0 0 6px; }
  .chain { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0 0 20px; }
  .pbox { background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:8px 10px;
          min-width:140px; cursor:pointer; }
  .pbox:hover { border-color:var(--acc); }
  .pbox .addr { color:var(--acc); font-weight:700; }
  .pbox .kind { color:var(--dim); font-size:11px; margin-left:6px; }
  .pports { font-size:11px; color:var(--dim); margin-top:3px; }
  .pdials { margin-top:5px; font-size:12px; white-space:pre-wrap; word-break:break-all; max-width:220px; }
  .parr { font-size:11px; padding:3px 6px; border-radius:4px; border:1px solid transparent; }
  .parr.bad { border-color:#f8514966; background:#f8514911; }
  .loose { display:flex; flex-wrap:wrap; gap:8px; }
  .loose .pbox { min-width:120px; }
  /* grid tab */
  #gridwrap { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:10px; flex:2 1 480px; }
  .cell { background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:10px; cursor:pointer; }
  .cell:hover { border-color:var(--acc); }
  .cell.sel { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc); }
  .cell .addr { color:var(--acc); font-weight:700; } .cell .kind { color:var(--dim); font-size:12px; }
  .dials { margin-top:6px; white-space:pre-wrap; word-break:break-all; }
  .bar { height:8px; background:#1f6feb33; border-radius:2px; margin:3px 0; position:relative; }
  .bar i { position:absolute; inset:0 auto 0 0; background:#58a6ff; border-radius:2px; }
  .bar u { position:absolute; right:4px; top:-2px; font-size:10px; color:var(--dim); text-decoration:none; }
  #linksbox { flex:1 1 220px; background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:10px; }
  #linksbox h2, #panel h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0 0 8px; }
  .lk { padding:2px 0; } .lk b { color:var(--ink); }
  /* cell detail drawer */
  #panel { display:none; flex:0 0 auto; max-height:46%; overflow:auto; background:var(--panel);
           border-top:1px solid var(--edge); padding:12px 16px; }
  #panel .row { margin:8px 0; }
  .addr { color:var(--acc); font-weight:700; }
  pre.src { background:#0a0d12; border:1px solid var(--edge); border-radius:6px; padding:8px;
            overflow-x:auto; font-size:12px; white-space:pre-wrap; }
  .chip { background:var(--chip); border:1px dashed var(--warn); border-radius:6px; padding:8px; margin:8px 0; cursor:pointer; }
  .chip:hover { border-color:var(--acc); }
  .chip .tag { color:var(--warn); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .chip .cmd { color:var(--ink); font-size:11px; word-break:break-all; margin-top:4px; }
  .chip.copied { border-color:var(--ok); } .chip.copied .tag { color:var(--ok); }
  .reply { border-left:2px solid var(--ok); padding:4px 8px; margin:6px 0; }
  select { background:#0a0d12; color:var(--ink); border:1px solid var(--edge); border-radius:6px; padding:4px; font:inherit; }
  .x { float:right; padding:0 8px; }
  /* ---------- RIGHT: context panel (third column) ---------- */
  #context { display:flex; flex-direction:column; min-height:0; border-left:1px solid var(--edge); background:#10151c; }
  .ctxhead { display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid var(--edge);
             background:var(--panel); flex:0 0 auto; }
  .ctxhead h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0; flex:1; }
  .ctxbtn { padding:2px 8px; font-size:11px; }
  .ctxbtn.on { border-color:var(--acc); color:var(--acc); }
  #ctxchev { padding:2px 7px; }
  #ctxbody { flex:1; overflow:auto; padding:10px 12px; }
  #ctxbody .row { margin:6px 0; }
  main.ctxmin #ctxbody, main.ctxmin .ctxbtn, main.ctxmin .ctxhead h2 { display:none; }
  main.ctxmin .ctxhead { border-bottom:none; justify-content:center; padding:6px 2px; }
  .flegend { font-size:11px; margin-bottom:8px; }
  .faders { display:flex; gap:10px; align-items:flex-end; margin:4px 0 2px; }
  .fslot { display:flex; flex-direction:column; align-items:center; gap:2px; }
  .fader { writing-mode:vertical-lr; direction:rtl; width:26px; height:120px; accent-color:var(--acc);
           background:transparent; cursor:pointer; }
  .fv { font-size:11px; color:var(--acc); }
  .fl { font-size:10px; }
  .receipt { margin-top:10px; font-size:11px; min-height:16px; }
  .lvl { height:10px; background:#58a6ff22; border:1px solid var(--edge); border-radius:3px; overflow:hidden; margin:6px 0; }
  .lvl i { display:block; height:100%; width:22%; background:var(--ok); }
  .lvl.pulse i { animation:lvlpulse .9s ease-out; }
  @keyframes lvlpulse { 0% { width:96%; background:var(--acc); } 100% { width:22%; background:var(--ok); } }
  .lane { padding:2px 0 2px 8px; border-left:2px solid var(--acc); margin:4px 0; }
  .laneout { border-left-color:var(--ok); }
  .dgrid { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
  .dcell { width:52px; text-align:center; }
  .dv { color:var(--acc); font-size:12px; }
  .dbar { height:5px; background:#58a6ff22; border-radius:2px; overflow:hidden; margin:2px 0; }
  .dbar i { display:block; height:100%; background:var(--acc); }
  .di { font-size:10px; }
  .srctitle { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em; margin:10px 0 3px; }
  .srcmeta { font-size:10px; margin-bottom:2px; }
  .parr[data-a] { cursor:pointer; }
  .lkout[data-other], td.ports { cursor:pointer; }
  /* port popup (quilt-record download) */
  .modalwrap { display:none; position:fixed; inset:0; background:#000000aa; align-items:center; justify-content:center; z-index:50; }
  .modal { background:var(--panel); border:1px solid var(--edge); border-radius:10px; padding:16px;
           width:min(560px, 92vw); max-height:80vh; overflow:auto; }
  .modal h2 { margin:0 0 10px; font-size:13px; color:var(--acc); }
  #rec-preview { max-height:220px; overflow:auto; font-size:11px; margin:10px 0 0; white-space:pre-wrap; }
</style></head><body>
<header>
  <h1>quilt · three-panel workbench</h1>
  <span class="kv"><span id="dot"></span><b id="conn">connecting…</b></span>
  <span class="kv">tick <b id="tick">–</b></span>
  <span class="kv">ledger <b id="ledger">–</b></span>
  <span class="kv">tip <b id="tip">–</b></span>
  <span class="kv">cells <b id="ncells">0</b></span>
  <span class="kv">links <b id="nlinks">0</b></span>
</header>
<div class="banner">Display layer — one explicit write path: mixer faders POST /dials (rebind-in-place, click-only). Every other backend op shows as an explicit copy-paste chip.</div>
<div class="modes">presentation:
  <button id="m-raw" class="on">raw</button>
  <button id="m-dec">decoded</button>
  <button id="m-bars">bars</button>
  <span class="mut">(client-side re-projection only — state stays in your browser)</span>
</div>
<main>
  <section id="claw">
    <h2>claw session</h2>
    <div id="thread"><div class="mut empty">loading thread…</div></div>
    <div id="composer">
      <textarea id="q" placeholder="tell the agent what to build…"></textarea>
      <div class="crow"><button class="act" id="send">send</button>
        <span class="mut" id="sendmsg">goes to /tmp/canvas-web-questions.jsonl — no fabric op is executed</span></div>
    </div>
  </section>
  <section id="super">
    <div class="tabs">
      <button id="t-sheet" class="on" data-tab="sheet">sheet</button>
      <button id="t-pipeline" data-tab="pipeline">pipeline</button>
      <button id="t-grid" data-tab="grid">grid</button>
      <span class="mut">live via SSE · port validation is display-only</span>
    </div>
    <div id="tab-sheet" class="tab on"><table id="sheet"><thead></thead><tbody></tbody></table></div>
    <div id="tab-pipeline" class="tab"><div id="chains"></div></div>
    <div id="tab-grid" class="tab">
      <div id="gridwrap">
        <div id="grid"></div>
        <div id="linksbox"><h2>links</h2><div id="linklist"></div></div>
      </div>
    </div>
    <div id="panel">
      <h2>cell detail <button class="act x" id="p-close" title="close">×</button></h2>
      <div class="row"><span class="addr" id="p-addr"></span> <span class="mut" id="p-kind"></span>
        <span class="mut" id="p-ports"></span></div>
      <div class="row" id="p-dials"></div>
      <div class="row"><div class="mut">source (scanned from the board file):</div><pre class="src" id="p-src"></pre></div>
      <div class="row"><div class="mut">ask about this cell (never executes a fabric op):</div>
        <textarea id="p-q" placeholder="question about this cell…"></textarea>
        <div><button class="act" id="p-ask">ask</button> <span class="mut" id="p-askmsg"></span></div></div>
      <div class="row"><h2>needs a backend change?</h2>
        <div class="mut">click to copy the exact command. nothing here auto-executes.</div>
        <div id="p-chips"></div></div>
    </div>
  </section>
  <section id="context">
    <div class="ctxhead">
      <button class="act" id="ctxchev" title="collapse / expand the context panel">»</button>
      <h2>context</h2>
      <button class="act ctxbtn" id="ctx-code" title="show the underlying implementation (code view)">code</button>
      <button class="act ctxbtn" id="ctx-port" title="download a quilt-record (full / gist / hint)">port</button>
    </div>
    <div id="ctxbody"><div class="mut empty">click a cell or a port</div></div>
  </section>
</main>
<div class="modalwrap" id="recmodal">
  <div class="modal">
    <h2>quilt record <button class="act x" id="rec-close" title="close">×</button></h2>
    <div class="mut" style="font-size:11px;margin-bottom:8px">tier picks how much lands in the file: full = everything · gist = ledger tip + last 20 log entries · hint = readme + tip</div>
    <div class="crow">
      <button class="act tierbtn" data-tier="full">full</button>
      <button class="act tierbtn" data-tier="gist">gist</button>
      <button class="act tierbtn" data-tier="hint">hint</button>
      <span class="mut" id="rec-status"></span>
    </div>
    <pre id="rec-preview"></pre>
  </div>
</div>
<script>
(function () {
  var SOCK = ${sockJson};
  var KIND_PORTS = ${portsJson};
  var state = null, mode = "raw", selected = null, tab = "sheet";
  var ctx = { mode: "empty", addr: null, a: null, b: null, code: false, collapsed: false };
  var busyUntil = 0, lastTickSeen = null, tickPulse = false, codeReqId = 0;
  var sortKey = "addr", sortDir = 1;
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }
  function isSpool(kind) { return typeof kind === "string" && (kind.indexOf("spool:") === 0 || kind === "cudaclaw-board"); }
  function decode(kind, d) {
    if (!isSpool(kind) || d.length < 3) return null;
    return [d[0] + " turns", (d[1] / 100) + " tok/s", (d[2] * 10) + " ms spool"];
  }
  function dialHtml(c) {
    var d = c.dials || [];
    if (mode === "raw") return esc(JSON.stringify(d));
    if (mode === "decoded") { var dec = decode(c.kind, d); return dec ? esc(dec.join(" · ")) : esc(JSON.stringify(d)) + ' <span class="mut">(no known decoding)</span>'; }
    var max = 0; for (var i = 0; i < d.length; i++) if (d[i] > max) max = d[i];
    if (!max) return '<span class="mut">all zero</span>';
    var h = "";
    for (var j = 0; j < d.length; j++)
      h += '<div class="bar"><i style="width:' + (d[j] / max * 100).toFixed(1) + '%"></i><u>' + esc(String(d[j])) + '</u></div>';
    return h;
  }
  // ---- port registry helpers (display-layer validation + orientation only) ----
  // The fabric stores links UNDIRECTED (wire order is addr-sorted, not flow), so an
  // edge's drawn direction is projected from port flow: exactly one direction with
  // out(src) === in(dst) wins; otherwise fall back to wire order.
  function kindKnown(kind) { return !!KIND_PORTS[String(kind === null || kind === undefined ? "" : kind)]; }
  function portsOf(kind) { var p = KIND_PORTS[String(kind === null || kind === undefined ? "" : kind)]; return p ? { in: p.in, out: p.out, known: true } : { in: "?", out: "?", known: false }; }
  function portsStr(kind) {
    var p = portsOf(kind);
    if (!p.known) return "? → ?";
    return (p.in === null ? "–" : p.in) + " → " + (p.out === null ? "–" : p.out);
  }
  function matchTypes(srcKind, dstKind) {
    var s = KIND_PORTS[srcKind], d = KIND_PORTS[dstKind];
    return (s.out !== null && s.out === d.in) ? s.out : null;
  }
  function orientEdge(a, b) {
    var m = byAddr(); var ca = m[a], cb = m[b];
    var ka = ca ? ca.kind : undefined, kb = cb ? cb.kind : undefined;
    if (!kindKnown(ka) || !kindKnown(kb)) return { src: a, dst: b, label: "? → ?", cls: "unk", oriented: false };
    var fwd = matchTypes(ka, kb), rev = matchTypes(kb, ka);
    if (fwd && !rev) return { src: a, dst: b, label: fwd, cls: "ok", oriented: true };
    if (rev && !fwd) return { src: b, dst: a, label: rev, cls: "ok", oriented: true }; // wire order was flow-reversed — project the flow
    if (fwd && rev) return { src: a, dst: b, label: fwd, cls: "ok", oriented: false }; // both directions legal — wire order
    return { src: a, dst: b, label: "port mismatch", cls: "bad", oriented: false };
  }
  function byAddr() { var m = {}; if (state) state.cells.forEach(function (c) { m[c.addr] = c; }); return m; }
  function fmtTs(ts) { return new Date(ts).toLocaleTimeString(); }

  // ================= header + shared render =================
  function render() {
    if (!state) return;
    tickPulse = state.tick !== lastTickSeen; lastTickSeen = state.tick;
    $("tick").textContent = state.tick === null ? "–" : state.tick;
    $("ledger").textContent = state.ledger ? (state.ledger.ok ? "ok" : "UNVERIFIED") : "–";
    $("tip").textContent = state.ledger && state.ledger.tip ? String(state.ledger.tip).slice(0, 10) + "…" : "–";
    $("ncells").textContent = state.cells.length;
    $("nlinks").textContent = state.links.length;
    renderSheet();
    renderPipeline();
    renderGrid();
    if (selected) renderPanel(); else $("panel").style.display = "none";
    renderCtx();
  }

  // ================= TAB 1: sheet =================
  function renderSheet() {
    var rows = state.cells.map(function (c) {
      return { c: c, ports: portsStr(c.kind), known: kindKnown(c.kind),
               wires: state.links.filter(function (l) { return l[0] === c.addr || l[1] === c.addr; }) };
    });
    rows.sort(function (x, y) {
      function val(r) {
        switch (sortKey) {
          case "kind": return String(r.c.kind || "");
          case "ports": return r.ports;
          case "dials": return JSON.stringify(r.c.dials || []);
          case "links": return String(r.wires.length);
          default: return r.c.addr;
        }
      }
      var vx = val(x), vy = val(y);
      return vx < vy ? -sortDir : vx > vy ? sortDir : 0;
    });
    var cols = [["addr", "addr"], ["kind", "kind"], ["ports", "ports (in → out)"], ["dials", "dials"], ["links", "links (flow-oriented)"]];
    var th = "";
    cols.forEach(function (col) {
      var arrow = sortKey === col[0] ? (sortDir > 0 ? " ▲" : " ▼") : "";
      th += '<th data-k="' + col[0] + '"' + (sortKey === col[0] ? ' class="son"' : "") + '>' + esc(col[1]) + arrow + '</th>';
    });
    $("sheet").querySelector("thead").innerHTML = "<tr>" + th + "</tr>";
    Array.prototype.forEach.call($("sheet").querySelectorAll("th"), function (el) {
      el.onclick = function () {
        var k = el.getAttribute("data-k");
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
        renderSheet();
      };
    });
    var tb = $("sheet").querySelector("tbody");
    tb.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-addr", r.c.addr);
      if (selected === r.c.addr) tr.className = "sel";
      var lk = "";
      r.wires.forEach(function (l) {
        var o = orientEdge(l[0], l[1]); // links are stored undirected — show flow direction relative to this cell
        var bad = o.cls === "bad" ? '<span class="badge">port mismatch</span>' : '';
        if (o.src === r.c.addr && o.dst !== r.c.addr) lk += '<span class="lkout ' + o.cls + '" data-other="' + esc(o.dst) + '">→ ' + esc(o.dst) + bad + '</span>';
        else if (o.dst === r.c.addr && o.src !== r.c.addr) lk += '<span class="lkout ' + o.cls + '" data-other="' + esc(o.src) + '">' + esc(o.src) + ' →</span>';
        else lk += '<span class="lkout ' + o.cls + '">↔</span>';
      });
      if (!r.wires.length) lk = '<span class="mut">–</span>';
      tr.innerHTML =
        '<td><span class="addr">' + esc(r.c.addr) + '</span></td>' +
        '<td class="kind' + (r.known ? "" : " unk") + '" title="' + (r.known ? "known port semantics" : "unknown kind — ports assumed ? → ?") + '">' +
          esc(r.c.kind || "") + (r.known ? "" : ' <span class="mut">?</span>') + '</td>' +
        '<td class="ports' + (r.known ? "" : " unk") + '">' + esc(r.ports) + '</td>' +
        '<td class="dials">' + dialHtml(r.c) + '</td>' +
        '<td>' + lk + '</td>';
      tr.onclick = function () { select(r.c.addr); };
      tr.querySelectorAll("td")[2].onclick = function (e) { e.stopPropagation(); openPort(r.c.addr, null); }; // ports cell → code view
      Array.prototype.forEach.call(tr.querySelectorAll(".lkout[data-other]"), function (sp) {
        sp.onclick = function (e) { e.stopPropagation(); openPort(r.c.addr, sp.getAttribute("data-other")); };
      });
      tb.appendChild(tr);
    });
  }

  // ================= TAB 2: pipeline =================
  function buildChains() {
    var m = byAddr();
    var outMap = {}, inDeg = {}, seen = {};
    state.cells.forEach(function (c) { outMap[c.addr] = []; inDeg[c.addr] = 0; });
    state.links.forEach(function (l) {
      var a = l[0], b = l[1];
      if (!m[a] || !m[b] || a === b) return;
      var key = a < b ? a + "|" + b : b + "|" + a;
      if (seen[key]) return; seen[key] = 1; // fabric keeps pairs unique, but stay defensive
      var o = orientEdge(a, b);             // orient by port flow, not wire order
      outMap[o.src].push(o.dst); inDeg[o.dst]++;
    });
    var visited = {}, chains = [];
    function walkChain(start) {
      var path = [], cur = start;
      while (cur && !visited[cur]) {
        visited[cur] = true; path.push(cur);
        var nexts = outMap[cur].filter(function (n) { return !visited[n]; });
        if (!nexts.length) break;
        for (var i = 1; i < nexts.length; i++) chains.push(walkChain(nexts[i])); // branches become their own chains
        cur = nexts[0];
      }
      return path;
    }
    state.cells.filter(function (c) { return inDeg[c.addr] === 0; })
      .sort(function (a, b) { return a.addr < b.addr ? -1 : 1; })
      .forEach(function (c) { if (!visited[c.addr]) chains.push(walkChain(c.addr)); });
    state.cells.forEach(function (c) { if (!visited[c.addr]) chains.push(walkChain(c.addr)); }); // cycles
    var connected = chains.filter(function (ch) { return ch.length > 1; });
    var loose = chains.filter(function (ch) { return ch.length === 1; }).map(function (ch) { return ch[0]; })
      .sort(function (a, b) { return a < b ? -1 : 1; });
    return { chains: connected, loose: loose };
  }
  function pboxHtml(addr) {
    var m = byAddr(); var c = m[addr]; if (!c) return "";
    var known = kindKnown(c.kind);
    return '<div class="pbox" data-addr="' + esc(addr) + '" title="click for detail + chips">' +
      '<div><span class="addr">' + esc(addr) + '</span><span class="kind">' + esc(c.kind || "") + (known ? "" : " ?") + '</span></div>' +
      '<div class="pports">in ' + esc(portsStr(c.kind)) + '</div>' +
      '<div class="pdials">' + dialHtml(c) + '</div></div>';
  }
  function renderPipeline() {
    var g = buildChains();
    var el = $("chains"); el.innerHTML = "";
    if (!g.chains.length && !g.loose.length) { el.innerHTML = '<div class="mut">no cells bound yet</div>'; return; }
    g.chains.forEach(function (ch, i) {
      var wrap = document.createElement("div");
      wrap.innerHTML = '<div class="chainlabel">chain ' + (i + 1) + ' · ' + ch.length + ' cells</div>';
      var row = document.createElement("div"); row.className = "chain";
      ch.forEach(function (addr, j) {
        row.innerHTML += pboxHtml(addr);
        if (j < ch.length - 1) {
          var li = orientEdge(ch[j], ch[j + 1]); // path order follows oriented flow; label = the flowing port
          var lab = li.cls === "bad" ? "✗ " + esc(li.label) + " →" : esc(li.label) + " →";
          row.innerHTML += '<div class="parr ' + li.cls + '" data-a="' + esc(ch[j]) + '" data-b="' + esc(ch[j + 1]) + '">' + lab + '</div>';
        }
      });
      wrap.appendChild(row);
      Array.prototype.forEach.call(row.querySelectorAll(".pbox"), function (b) {
        b.onclick = function () { select(b.getAttribute("data-addr")); };
      });
      Array.prototype.forEach.call(row.querySelectorAll(".parr[data-a]"), function (ar) {
        ar.onclick = function (e) { e.stopPropagation(); openPort(ar.getAttribute("data-a"), ar.getAttribute("data-b")); };
      });
      el.appendChild(wrap);
    });
    if (g.loose.length) {
      var wrap = document.createElement("div");
      wrap.innerHTML = '<div class="chainlabel">loose cells · no links</div>';
      var row = document.createElement("div"); row.className = "loose";
      row.innerHTML = g.loose.map(pboxHtml).join("");
      wrap.appendChild(row);
      Array.prototype.forEach.call(row.querySelectorAll(".pbox"), function (b) {
        b.onclick = function () { select(b.getAttribute("data-addr")); };
      });
      el.appendChild(wrap);
    }
  }

  // ================= TAB 3: grid (preserved) =================
  function renderGrid() {
    var g = $("grid"); g.innerHTML = "";
    state.cells.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "cell" + (selected === c.addr ? " sel" : "");
      el.setAttribute("data-addr", c.addr);
      el.innerHTML = '<span class="addr">' + esc(c.addr) + '</span> <span class="kind">' + esc(c.kind || "") + '</span>' +
                     '<div class="dials">' + dialHtml(c) + '</div>';
      el.onclick = function () { select(c.addr); };
      g.appendChild(el);
    });
    var ll = $("linklist"); ll.innerHTML = "";
    if (!state.links.length) ll.innerHTML = '<div class="mut">no links</div>';
    state.links.forEach(function (l) {
      var o = orientEdge(l[0], l[1]);
      var el = document.createElement("div"); el.className = "lk " + o.cls;
      el.innerHTML = '<b>' + esc(o.src) + '</b> → <b>' + esc(o.dst) + '</b>' +
        '<span class="mut"> ' + esc(o.label) + '</span>' + (o.cls === "bad" ? '<span class="badge">port mismatch</span>' : '');
      ll.appendChild(el);
    });
  }

  // ================= RIGHT: context panel (third column) =================
  // Three states: empty / cell (detail block + kind frontend or generic inspector) /
  // code view. Plus the port popup (quilt-record download). Every fabric write from
  // this panel is an explicit user gesture (fader change → POST /dials).
  function setCtxCollapsed(v) {
    ctx.collapsed = v;
    document.querySelector("main").classList.toggle("ctxmin", v);
    $("ctxchev").textContent = v ? "«" : "»";
  }
  function openPort(a, b) {
    busyUntil = 0;
    ctx.mode = "port"; ctx.addr = null; ctx.a = a; ctx.b = b || null; ctx.code = true;
    selected = null; $("panel").style.display = "none";
    if (ctx.collapsed) setCtxCollapsed(false); // a port click opens the panel
    render();
  }
  function ctxFlow(c) { // flow-oriented in/out neighbor lists for a cell
    var ins = [], outs = [];
    state.links.forEach(function (l) {
      if (l[0] !== c.addr && l[1] !== c.addr) return;
      var o = orientEdge(l[0], l[1]);
      if (o.src === c.addr && o.dst !== c.addr) outs.push(o.dst);
      else if (o.dst === c.addr && o.src !== c.addr) ins.push(o.src);
      else { var other = l[0] === c.addr ? l[1] : l[0]; ins.push(other); outs.push(other); }
    });
    return { ins: ins, outs: outs };
  }
  function postDials(addr, dials) {
    var rc = document.getElementById("ctxreceipt");
    if (rc) rc.textContent = "setting " + addr + " …";
    fetch("/dials", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ addr: addr, dials: dials }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        var el = document.getElementById("ctxreceipt"); if (!el) return;
        if (o.ok) el.innerHTML = "set ✓ tick <b>" + esc(String(o.j.tick)) + "</b> · tip <b>" +
          esc(String((o.j.ledger && o.j.ledger.tip) ? String(o.j.ledger.tip).slice(0, 8) : "–")) + "</b>";
        else el.innerHTML = '<span class="bad">error: ' + esc(o.j.error || "unknown") + "</span>";
      })
      .catch(function (e) { var el = document.getElementById("ctxreceipt"); if (el) el.innerHTML = '<span class="bad">error: ' + esc(e.message) + "</span>"; });
  }
  function feMixer(el, c) {
    var dials = (c.dials || []).slice(0, 8);
    var wrap = document.createElement("div");
    wrap.innerHTML = '<div class="mut flegend">mixer — channel gains · drag a fader = explicit POST /dials (rebind-in-place)</div>';
    var rack = document.createElement("div"); rack.className = "faders";
    var inputs = [];
    dials.forEach(function (v0, i) {
      var v = Math.max(0, Math.min(127, Number(v0) || 0));
      var slot = document.createElement("div"); slot.className = "fslot";
      slot.innerHTML = '<input type="range" class="fader" min="0" max="127" step="1" value="' + v + '">' +
        '<div class="fv">' + v + '</div><div class="mut fl">ch' + (i + 1) + '</div>';
      var inp = slot.querySelector("input"), fv = slot.querySelector(".fv");
      inp.addEventListener("input", function () { fv.textContent = inp.value; busyUntil = Date.now() + 1200; });
      inp.addEventListener("change", function () {
        var all = inputs.map(function (x) { return Number(x.value); });
        postDials(c.addr, all); // explicit user gesture: rebind-in-place with ALL dials
      });
      inputs.push(inp); rack.appendChild(slot);
    });
    if (!dials.length) wrap.innerHTML += '<div class="mut">no dials on this cell</div>';
    wrap.appendChild(rack);
    var rc = document.createElement("div"); rc.className = "mut receipt"; rc.id = "ctxreceipt";
    rc.textContent = "receipt line after each set (tick · ledger tip)";
    wrap.appendChild(rc);
    el.appendChild(wrap);
  }
  function feLevel(el, c) {
    var wrap = document.createElement("div");
    wrap.innerHTML = '<div class="mut flegend">' + esc(c.kind) + ' — level (pulses on each fabric tick)</div>' +
      '<div class="lvl' + (tickPulse ? " pulse" : "") + '"><i></i></div>' +
      '<div class="mut" style="margin-top:6px">ports ' + esc(portsStr(c.kind)) + "</div>";
    el.appendChild(wrap);
  }
  function feLlm(el, c) {
    var f = ctxFlow(c);
    var wrap = document.createElement("div");
    wrap.innerHTML = '<div class="mut flegend">llm — text-in → text-out lanes</div>' +
      '<div class="lane"><span class="mut">text in ←</span> ' + (f.ins.length ? f.ins.map(esc).join(", ") : '<span class="mut">–</span>') + "</div>" +
      '<div class="lane laneout"><span class="mut">text out →</span> ' + (f.outs.length ? f.outs.map(esc).join(", ") : '<span class="mut">–</span>') + "</div>";
    el.appendChild(wrap);
  }
  function feGeneric(el, c) {
    var d = c.dials || [], f = ctxFlow(c);
    var h = '<div class="mut flegend">inspector — dials grid + links</div><div class="dgrid">';
    d.forEach(function (v, i) {
      var pct = Math.max(0, Math.min(127, Number(v) || 0)) / 127 * 100;
      h += '<div class="dcell"><div class="dv">' + esc(String(v)) + '</div><div class="dbar"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="mut di">' + i + "</div></div>";
    });
    h += "</div>";
    h += '<div class="mut" style="margin-top:8px">links (flow-oriented):</div>';
    var wires = state.links.filter(function (l) { return l[0] === c.addr || l[1] === c.addr; });
    if (!wires.length) h += '<div class="mut">–</div>';
    wires.forEach(function (l) {
      var o = orientEdge(l[0], l[1]);
      h += '<div class="lk ' + o.cls + '"><b>' + esc(o.src) + "</b> → <b>" + esc(o.dst) + '</b><span class="mut"> ' + esc(o.label) + "</span></div>";
    });
    var wrap = document.createElement("div"); wrap.innerHTML = h; el.appendChild(wrap);
  }
  var FRONTENDS = { mixer: feMixer, mic: feLevel, speaker: feLevel, llm: feLlm }; // kind → render fn; falls back to feGeneric
  function renderCtx() {
    var body = $("ctxbody"); if (!body) return;
    $("ctx-code").style.display = ctx.mode === "empty" ? "none" : "";
    $("ctx-code").className = "act ctxbtn" + (ctx.code ? " on" : "");
    if (ctx.mode === "empty") { body.innerHTML = '<div class="mut empty">click a cell or a port</div>'; return; }
    if (Date.now() < busyUntil) return; // fader drag in progress — never clobber the DOM mid-gesture
    if (ctx.code || ctx.mode === "port") { renderCtxCode(body); return; }
    var c = state.cells.find(function (x) { return x.addr === ctx.addr; });
    if (!c) { ctx.mode = "empty"; body.innerHTML = '<div class="mut empty">click a cell or a port</div>'; return; }
    var known = kindKnown(c.kind), f = ctxFlow(c);
    body.innerHTML =
      '<div class="row"><span class="addr">' + esc(c.addr) + "</span> <span>" + esc(c.kind || "") + (known ? "" : ' <span class="mut">?</span>') + "</span></div>" +
      '<div class="row mut">ports ' + esc(portsStr(c.kind)) + (known ? "" : " (unknown kind)") + "</div>" +
      '<div class="row">dials <b>' + esc(JSON.stringify(c.dials || [])) + "</b></div>" +
      '<div class="row"><span class="mut">in ←</span> ' + (f.ins.length ? f.ins.map(esc).join(", ") : '<span class="mut">–</span>') + "</div>" +
      '<div class="row"><span class="mut">out →</span> ' + (f.outs.length ? f.outs.map(esc).join(", ") : '<span class="mut">–</span>') + "</div>";
    var fe = document.createElement("div"); fe.className = "ctxfe";
    body.appendChild(fe);
    (FRONTENDS[String(c.kind || "").toLowerCase()] || feGeneric)(fe, c);
  }
  function renderCtxCode(body) {
    var tok = ++codeReqId;
    var head = "";
    if (ctx.mode === "port") {
      var m = byAddr(), ca = m[ctx.a], cb = ctx.b ? m[ctx.b] : null;
      var o = ctx.b ? orientEdge(ctx.a, ctx.b) : null;
      head = '<div class="row">port <b>' + esc(ctx.a) + "</b>" + (ctx.b ? " → <b>" + esc(ctx.b) + "</b>" : "") +
        (o ? ' <span class="' + o.cls + '">' + esc(o.label) + "</span>" : "") + "</div>" +
        '<div class="row mut">' + esc(ca ? ca.kind : "?") + " → " + esc(cb ? cb.kind : "?") + " — registry entries + ops wire format:</div>";
    } else if (ctx.mode === "cell") {
      head = '<div class="row">code — underlying implementation of <b>' + esc(ctx.addr || "") + "</b>:</div>";
    } else {
      head = '<div class="row mut">code — fabric implementation excerpts:</div>';
    }
    body.innerHTML = head + '<div class="mut empty">loading source…</div>';
    Promise.all([
      fetch("/source?name=ports").then(function (r) { return r.json(); }),
      fetch("/source?name=ops").then(function (r) { return r.json(); })
    ]).then(function (secs) {
      if (tok !== codeReqId) return; // a newer view took over
      var h = head;
      if (ctx.mode === "cell" && ctx.addr) {
        h += '<div class="srctitle">bind line — scanned from the board file</div><pre class="src" id="ctxcellsrc">…</pre>';
      }
      secs.forEach(function (s) {
        h += '<div class="srctitle">' + esc(String(s.name || "?") + " · " + (s.label || "")) + "</div>" +
          (s.text !== undefined && s.text !== null
            ? '<div class="mut srcmeta">' + esc(String(s.path)) + " :" + esc(String(s.from_line)) + "–" + esc(String(s.to_line)) + '</div><pre class="src">' + esc(s.text) + "</pre>"
            : '<pre class="src">// ' + esc(s.error || "unavailable") + "</pre>");
      });
      body.innerHTML = h;
      if (ctx.mode === "cell" && ctx.addr) {
        fetch("/cell/" + encodeURIComponent(ctx.addr)).then(function (r) { return r.json(); }).then(function (s) {
          var el = document.getElementById("ctxcellsrc");
          if (el) el.textContent = (s.source_excerpt !== null && s.source_excerpt !== undefined)
            ? "// " + s.source_path + (s.source_line ? " :" + s.source_line : "") + "\\n" + s.source_excerpt
            : "// " + (s.reason || "no bind line found");
        }).catch(function () {});
      }
    }).catch(function (e) {
      if (tok === codeReqId) body.innerHTML = head + '<pre class="src">// source fetch failed: ' + esc(e.message) + "</pre>";
    });
  }

  // ================= cell detail drawer (chips live here) =================
  function sockCmd(ndjson) {
    var node = 'const net=require("net");const s=net.createConnection(' + JSON.stringify(SOCK) + ');' +
               's.on("connect",()=>s.write(require("fs").readFileSync(0,"utf8")));' +
               's.on("data",(d)=>process.stdout.write(d));';
    var payload = JSON.stringify(ndjson).replace(/'/g, "'\\''");
    return "echo '" + payload + "' | timeout 2 node -e '" + node + "'";
  }
  function copyCmd(cmd, el) {
    function done() {
      var prev = el.className; el.className = prev + " copied";
      var t = el.querySelector(".tag");
      if (t) { var old = t.textContent; t.textContent = "copied ✓ (paste it in a shell — it runs only when YOU run it)"; setTimeout(function () { el.className = prev; t.textContent = old; }, 2500); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(done);
    else { var ta = document.createElement("textarea"); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); }
  }
  function renderPanel() {
    var c = state.cells.find(function (x) { return x.addr === selected; });
    if (!c) { selected = null; $("panel").style.display = "none"; return; }
    $("panel").style.display = "block";
    $("p-addr").textContent = c.addr;
    $("p-kind").textContent = c.kind || "";
    var known = kindKnown(c.kind);
    $("p-ports").textContent = "ports " + portsStr(c.kind) + (known ? "" : "  (unknown kind — assumed ? → ?)");
    $("p-dials").innerHTML = "raw dials: <b>" + esc(JSON.stringify(c.dials)) + "</b>" +
      (decode(c.kind, c.dials) ? '<div class="mut">decoded: ' + esc(decode(c.kind, c.dials).join(" · ")) + '</div>' : "");
    fetch("/cell/" + encodeURIComponent(c.addr)).then(function (r) { return r.json(); }).then(function (s) {
      $("p-src").textContent = s.source_excerpt !== null && s.source_excerpt !== undefined
        ? "// " + s.source_path + (s.source_line ? " :" + s.source_line : "") + "\\n" + s.source_excerpt
        : "// " + (s.reason || "no bind line found");
    });
    var chips = $("p-chips"); chips.innerHTML = "";
    var list = [
      { label: "re-BIND " + c.addr + " (re-assert these dials)", cmd: sockCmd({ type: "opcode", op: "BIND", cell: c.addr, args: { dials: c.dials, kind: c.kind } }) },
      { label: "TICK the fabric", cmd: sockCmd({ type: "opcode", op: "TICK", cell: "graph", args: {} }) }
    ];
    var others = state.cells.filter(function (x) { return x.addr !== c.addr; }).map(function (x) { return x.addr; });
    if (others.length) {
      var row = document.createElement("div"); row.className = "chip";
      var sel = document.createElement("select");
      others.forEach(function (a) { var o = document.createElement("option"); o.value = a; o.textContent = a; sel.appendChild(o); });
      var lbl = document.createElement("span"); lbl.className = "tag"; lbl.textContent = " LINK " + c.addr + " → ";
      var go = document.createElement("button"); go.className = "act"; go.textContent = "copy link command";
      go.onclick = function () { copyCmd(sockCmd({ type: "opcode", op: "LINK", cell: "graph", args: { a: c.addr, b: sel.value } }), go); };
      row.appendChild(lbl); row.appendChild(sel); row.appendChild(go);
      chips.appendChild(row);
    }
    list.forEach(function (ch) {
      var el = document.createElement("div"); el.className = "chip";
      el.innerHTML = '<div class="tag">needs backend change — copy this command · ' + esc(ch.label) + '</div>' +
                     '<div class="cmd">' + esc(ch.cmd) + '</div>';
      el.onclick = function () { copyCmd(ch.cmd, el); };
      chips.appendChild(el);
    });
  }
  function select(addr) {
    selected = addr; busyUntil = 0;
    ctx.mode = "cell"; ctx.addr = addr; ctx.a = null; ctx.b = null; ctx.code = false;
    render();
  }

  // ================= LEFT: claw session thread =================
  function opLabel(op) {
    if (typeof op === "string") return op;
    if (op && typeof op === "object") {
      if (op.op === "link" && (op.from || op.to)) return "link " + (op.from || "?") + " → " + (op.to || "?");
      var bits = [op.op || "op"];
      if (op.addr) bits.push(op.addr);
      if (op.kind) bits.push(op.kind);
      if (bits.length > 1) return bits.join(" ");
      return op.detail || op.op || JSON.stringify(op).slice(0, 48);
    }
    return String(op);
 }
  function opAddr(op) {
    if (typeof op === "string") { var m = op.match(/\\b([A-Za-z]{1,2}[0-9]{1,3})\\b/); return m ? m[1] : null; }
    if (op && typeof op === "object") return op.addr || op.from || op.to || null;
    return null;
 }
  function replyEl(r) {
    var d = document.createElement("div"); d.className = "msg op";
    var from = r.from || "operator";
    var head = '<span class="from ' + esc(from) + '">' + esc(from) + '</span>' +
               '<span class="mut t">' + esc(fmtTs(r.ts || Date.now())) + '</span>';
    var body = r.reply !== undefined && r.reply !== null ? r.reply : JSON.stringify(r);
    d.innerHTML = head + '<div class="body">' + esc(body) + '</div>';
    if (r.question) { var qq = document.createElement("div"); qq.className = "mut qref"; qq.textContent = "re: " + r.question; d.appendChild(qq); }
    (r.ops_applied || []).forEach(function (op) {
      var chip = document.createElement("span"); chip.className = "opchip";
      chip.textContent = opLabel(op);
      chip.title = "click to highlight the affected cell";
      chip.onclick = function () { var a = opAddr(op); if (a) focusCell(a); };
      d.appendChild(chip);
    });
    return d;
  }
  function renderThread(ib) {
    var el = $("thread");
    var stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
    el.innerHTML = "";
    if ((!ib.questions || !ib.questions.length) && !(ib.unmatched_replies || []).length) {
      el.innerHTML = '<div class="mut empty">no messages yet — tell the agent what to build below.</div>';
      return;
    }
    (ib.questions || []).forEach(function (q) {
      var qd = document.createElement("div");
      qd.className = "msg user" + (q.answered ? "" : " await");
      qd.innerHTML = '<span class="from">you</span><span class="mut t">' + esc(fmtTs(q.ts)) +
        (q.addr ? " · " + esc(q.addr) : "") + '</span><div class="body">' + esc(q.question) + '</div>';
      if (!q.answered) { var w = document.createElement("div"); w.className = "awaiting"; w.textContent = "…awaiting operator"; qd.appendChild(w); }
      el.appendChild(qd);
      (q.replies || []).forEach(function (r) { el.appendChild(replyEl(r)); });
    });
    if ((ib.unmatched_replies || []).length) {
      var u = document.createElement("div"); u.className = "mut"; u.style.marginTop = "16px";
      u.textContent = "unmatched replies (no matching question):";
      el.appendChild(u);
      ib.unmatched_replies.forEach(function (r) { el.appendChild(replyEl(r)); });
    }
    if (stick) el.scrollTop = el.scrollHeight;
  }
  function pollThread() {
    fetch("/inbox").then(function (r) { return r.json(); }).then(renderThread).catch(function () {});
  }
  function sendAsk() {
    var v = $("q").value.trim();
    if (!v) return;
    $("sendmsg").textContent = "sending…";
    fetch("/ask", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ addr: "", question: v }) })
      .then(function (r) { return r.json(); })
      .then(function (o) {
        if (o.ok) { $("q").value = ""; $("sendmsg").textContent = "logged ts=" + o.ts + " — awaiting operator"; pollThread(); }
        else $("sendmsg").textContent = "error: " + o.error;
        setTimeout(function () { $("sendmsg").textContent = "goes to /tmp/canvas-web-questions.jsonl — no fabric op is executed"; }, 4000);
      });
  }
  $("send").onclick = sendAsk;
  $("q").addEventListener("keydown", function (e) {
    if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); sendAsk(); }
  });

  // cross-panel highlight: ops_applied chip → affected cell in the right panel
  function focusCell(addr) {
    if (!addr || !state) return;
    var el = $("tab-" + tab).querySelector('[data-addr="' + addr + '"]');
    if (!el) { setTab("sheet"); el = $("tab-sheet").querySelector('[data-addr="' + addr + '"]'); }
    if (!el) return;
    select(addr);
    el = $("tab-" + tab).querySelector('[data-addr="' + addr + '"]');
    if (!el) return;
    el.classList.add("hl");
    if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
    setTimeout(function () { el.classList.remove("hl"); }, 2600);
  }

  // tabs + presentation toggles
  function setTab(t) {
    tab = t;
    ["sheet", "pipeline", "grid"].forEach(function (k) {
      $("t-" + k).className = k === t ? "on" : "";
      $("tab-" + k).className = "tab" + (k === t ? " on" : "");
    });
  }
  ["sheet", "pipeline", "grid"].forEach(function (k) {
    $("t-" + k).onclick = function () { setTab(k); };
  });
  function setMode(m) {
    mode = m;
    ["raw", "dec", "bars"].forEach(function (k) { $("m-" + k).className = k === m ? "on" : ""; });
    render(); // pure client-side re-projection: no fetch, no server round-trip
  }
  $("m-raw").onclick = function () { setMode("raw"); };
  $("m-dec").onclick = function () { setMode("dec"); };
  $("m-bars").onclick = function () { setMode("bars"); };
  $("p-close").onclick = function () { selected = null; render(); };
  $("p-ask").onclick = function () {
    var q = $("p-q").value.trim();
    if (!q || !selected) { $("p-askmsg").textContent = "select a cell and type a question"; return; }
    fetch("/ask", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: selected, question: q }) })
      .then(function (r) { return r.json(); })
      .then(function (o) {
        $("p-askmsg").textContent = o.ok ? "logged (ts=" + o.ts + ") — appears in the claw thread" : "error: " + o.error;
        if (o.ok) { $("p-q").value = ""; pollThread(); }
      });
  };

  // context panel wiring
  $("ctxchev").onclick = function () { setCtxCollapsed(!ctx.collapsed); };
  $("ctx-code").onclick = function () {
    if (ctx.mode === "empty") return;
    ctx.code = !ctx.code; render();
  };
  // port popup: quilt-record download (explicit click → explicit fetch → explicit download)
  $("ctx-port").onclick = function () { $("recmodal").style.display = "flex"; };
  $("rec-close").onclick = function () { $("recmodal").style.display = "none"; };
  $("recmodal").onclick = function (e) { if (e.target === this) this.style.display = "none"; };
  Array.prototype.forEach.call(document.querySelectorAll(".tierbtn"), function (b) {
    b.onclick = function () {
      var tier = b.getAttribute("data-tier");
      var st = $("rec-status"); st.textContent = "fetching " + tier + " …";
      $("rec-preview").textContent = "";
      fetch("/record?tier=" + tier).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j, cd: r.headers.get("content-disposition") }; });
      }).then(function (o) {
        if (!o.ok) { st.innerHTML = '<span class="bad">HTTP ' + o.status + "</span> " + esc(o.j.error || ""); return; }
        var m = /filename="([^"]+)"/.exec(o.cd || "");
        var fname = m ? m[1] : "quilt-record-" + tier + "-" + Date.now() + ".json";
        var text = JSON.stringify(o.j, null, 2);
        var blob = new Blob([text], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        st.innerHTML = "downloaded <b>" + esc(fname) + "</b> · schema <b>" + esc(String(o.j.schema || "?")) + "</b> · tip <b>" +
          esc(String(o.j.ledger && o.j.ledger.tip ? String(o.j.ledger.tip).slice(0, 10) : "–")) + "</b>";
        $("rec-preview").textContent = text.length > 1600 ? text.slice(0, 1600) + "\\n… (" + text.length + " bytes)" : text;
      }).catch(function (e) { st.textContent = "error: " + e.message; });
    };
  });

  // live wiring
  var es = new EventSource("/events");
  es.onopen = function () { $("dot").className = "on"; $("conn").textContent = "live (SSE)"; };
  es.onerror = function () { $("dot").className = ""; $("conn").textContent = "reconnecting…"; };
  es.onmessage = function (e) {
    try { state = JSON.parse(e.data); } catch (err) { return; }
    render();
  };
  pollThread();
  setInterval(pollThread, 2000); // claw thread: poll /inbox every 2s
})();
</script>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    const body = page();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
  } else if (req.method === "GET" && p === "/state.json") {
    json(res, 200, {
      sock: SOCK, connected: state.connected, tick: state.tick,
      ledger: { ok: state.ledgerOk, tip: state.ledgerTip },
      cells: state.cells, links: state.links, updated_at: state.updatedAt,
    });
  } else if (req.method === "GET" && p === "/ports") {
    json(res, 200, {
      registry: KIND_PORTS,
      note: "display-layer port semantics only — the fabric is type-agnostic, never rejects a LINK on port types, and stores links UNDIRECTED (wire order is addr-sorted, not flow). Projections orient edges by port flow: exactly one direction with out(src)===in(dst) wins, otherwise wire order. Schema: single in/out port per kind, null = no port on that side. Unknown kinds render as ? → ?. Link colors: green = port flow match, red = mismatch, gray = unknown kind involved. Shared table: bridge/pipeline_view.mjs KIND_PORTS.",
    });
  } else if (req.method === "GET" && p === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    sseClients.add(res);
    // initial snapshot so a fresh browser is never blank
    res.write(`data: ${JSON.stringify({ type: "update", tick: state.tick, cells: state.cells, links: state.links,
      ledger: { ok: state.ledgerOk, tip: state.ledgerTip }, hello: true, at: new Date().toISOString() })}\n\n`);
    req.on("close", () => sseClients.delete(res));
  } else if (req.method === "GET" && p.startsWith("/cell/")) {
    const addr = decodeURIComponent(p.slice("/cell/".length));
    const cell = state.cells.find((c) => c.addr === addr);
    if (!cell) return json(res, 404, { error: "no such cell in current state", addr });
    const src = findSourceExcerpt(addr);
    json(res, 200, {
      addr, kind: cell.kind, dials: cell.dials,
      source_path: BOARD_FILE,
      source_line: src.found ? src.line : null,
      source_excerpt: src.found ? src.excerpt : null,
      reason: src.found ? undefined : src.reason,
    });
  } else if (req.method === "GET" && p === "/source") {
    // name-KEYED whitelist only — the query param is never a path, so traversal is impossible
    const name = u.searchParams.get("name") || "";
    if (!Object.prototype.hasOwnProperty.call(SOURCE_SECTIONS, name))
      return json(res, 404, { error: "unknown source key", allowed: Object.keys(SOURCE_SECTIONS), note: "name-keyed whitelist only — no path params" });
    const sec = sourceSection(name);
    if (!sec) return json(res, 404, { error: "section markers not found for key", name });
    json(res, 200, { name, ...sec });
  } else if (req.method === "GET" && p === "/record") {
    const tier = u.searchParams.get("tier");
    if (tier !== "full" && tier !== "gist" && tier !== "hint")
      return json(res, 400, { error: "tier must be full|gist|hint", got: tier });
    // lazy import: the record lane lands bridge/record.mjs (renderRecord(tier) → quilt-record/v1 object);
    // until then this route answers 503 instead of failing the server.
    const rec = await import("./record.mjs").catch(() => null);
    if (!rec || typeof rec.renderRecord !== "function")
      return json(res, 503, { error: "record module landing" });
    try {
      const obj = await rec.renderRecord(tier);
      const body = JSON.stringify(obj, null, 2) + "\n";
      const fname = `quilt-record-${tier}-${Date.now()}.json`;
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "content-disposition": `attachment; filename="${fname}"`,
      });
      res.end(body);
    } catch (e) {
      json(res, 500, { error: `renderRecord(${tier}) failed: ${e.message}` });
    }
  } else if (req.method === "POST" && p === "/dials") {
    // the ONE explicit-write path: rebind an EXISTING cell in place (same addr, same
    // kind, new dials) over the same wire BIND opcode the drawer chips use.
    // Explicit POST only — never fired by hover/render; never binds a new cell; never deletes.
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 8192) req.destroy(); });
    req.on("end", async () => {
      let msg;
      try { msg = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "body must be JSON" }); }
      if (typeof msg.addr !== "string" || !/^[A-Z][0-9]{1,2}$/.test(msg.addr))
        return json(res, 400, { error: "bad addr — want ^[A-Z][0-9]{1,2}$ like M1", got: msg.addr ?? null });
      const dials = msg.dials;
      if (!Array.isArray(dials) || dials.length < 1 || dials.length > 8 ||
          !dials.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 127))
        return json(res, 400, { error: "dials must be a numeric array, 1–8 entries, each 0–127" });
      const cell = state.cells.find((c) => c.addr === msg.addr);
      if (!cell)
        return json(res, 404, { error: "no such cell in current state — this route rebinds in place only, it never creates", addr: msg.addr });
      try {
        const upd = await sendOpcode({ type: "opcode", op: "BIND", cell: cell.addr, args: { dials, kind: cell.kind } });
        const after = (upd.cells || []).find((c) => c.addr === cell.addr);
        process.stderr.write(`[web-projection] /dials rebind-in-place ${cell.addr} kind=${cell.kind} dials=${JSON.stringify(dials)} tick=${upd.tick}\n`);
        json(res, 200, {
          ok: !!after && after.kind === cell.kind,
          addr: cell.addr,
          kind: cell.kind,
          dials: after ? after.dials : dials,
          tick: upd.tick ?? null,
          ledger: upd.ledger ?? null,
          note: "rebind-in-place via wire BIND: same addr, same kind, new dials",
        });
      } catch (e) {
        json(res, 502, { error: `controller socket: ${e.message}` });
      }
    });
  } else if (req.method === "POST" && p === "/ask") {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 8192) req.destroy(); });
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body || "{}"); } catch { return json(res, 400, { error: "body must be JSON" }); }
      if (typeof msg.question !== "string" || !msg.question.trim())
        return json(res, 400, { error: "need { addr, question }" });
      const rec = { ts: Date.now(), addr: String(msg.addr || ""), question: msg.question.trim(), answered: false };
      appendJsonl(QUESTIONS_FILE, rec);
      // deliberately NO socket write here — the display layer never mutates the fabric
      process.stderr.write(`[web-projection] ask logged: addr=${rec.addr} q=${rec.question.slice(0, 60)}\n`);
      json(res, 200, { ok: true, ts: rec.ts, file: QUESTIONS_FILE, note: "logged for the operator; no fabric op executed" });
    });
  } else if (req.method === "GET" && p === "/favicon.ico") {
    res.writeHead(204); res.end(); // browsers always ask; silence the console 404
  } else if (req.method === "GET" && p === "/inbox") {
    json(res, 200, inbox());
  } else {
    json(res, 404, { error: "not found", endpoints: ["/", "/state.json", "/events", "/ports", "/cell/<addr>", "/source?name=ports|ops|builder", "/record?tier=full|gist|hint", "/dials (POST)", "/ask (POST)", "/inbox"] });
  }
});

let boundPort = null;
function tryListen(i) {
  if (i >= FALLBACK_PORTS.length) {
    process.stderr.write(`[web-projection] FAIL: every port ${FALLBACK_PORTS[0]}-${FALLBACK_PORTS[FALLBACK_PORTS.length - 1]} busy\n`);
    process.exit(1);
  }
  const port = FALLBACK_PORTS[i];
  const onErr = (e) => {
    if (e.code === "EADDRINUSE") {
      process.stderr.write(`[web-projection] port ${port} busy, trying ${FALLBACK_PORTS[i + 1] ?? "nothing"}\n`);
      tryListen(i + 1);
    } else {
      process.stderr.write(`[web-projection] FAIL: ${e.message}\n`);
      process.exit(1);
    }
  };
  server.once("error", onErr);
  server.listen(port, "127.0.0.1", () => {
    server.removeListener("error", onErr);
    boundPort = port;
    process.stderr.write(
      `[web-projection] serving http://localhost:${port} (fabric peer on ${SOCK}; read-only — ops are copy-paste chips only)\n`
    );
  });
}
tryListen(0);
