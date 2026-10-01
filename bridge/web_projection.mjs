#!/usr/bin/env node
// web_projection.mjs — browser projection of the mission-command workbench.
// The fleet captain watches the same quilt in a browser that agents watch in tmux.
// PEER, never a mutator: this process only sends `ready` on the socket — every
// backend op is surfaced as an explicit copy-paste chip, nothing auto-executes.
// Zero npm deps (node stdlib only).
// Run: PORT=8799 QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node bridge/web_projection.mjs
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/cudaclaw.sock";
const BASE_PORT = parseInt(process.env.PORT || "8799", 10);
const FALLBACK_PORTS = [BASE_PORT, 8800, 8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808, 8809, 8810]
  .filter((p, i, a) => a.indexOf(p) === i);
const BOARD_FILE = path.join(import.meta.dirname, "cudaclaw_board.mjs"); // source-of-truth scan target
const QUESTIONS_FILE = "/tmp/canvas-web-questions.jsonl";
const ANSWERS_FILE = "/tmp/canvas-web-answers.jsonl";

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
  const questions = readJsonl(QUESTIONS_FILE).map((q, index) => ({ index, ...q, replies: [] }));
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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quilt — web projection (cudaclaw)</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --edge:#30363d; --ink:#c9d1d9; --dim:#8b949e;
          --acc:#58a6ff; --ok:#3fb950; --warn:#d29922; --chip:#21262d; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 ui-monospace,Menlo,Consolas,monospace; }
  header { display:flex; flex-wrap:wrap; gap:10px 22px; align-items:baseline; padding:12px 16px;
           border-bottom:1px solid var(--edge); background:var(--panel); }
  header h1 { font-size:15px; margin:0; color:var(--acc); }
  .kv { color:var(--dim); } .kv b { color:var(--ink); font-weight:600; }
  #dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--warn); margin-right:5px; }
  #dot.on { background:var(--ok); }
  .banner { padding:8px 16px; background:#202a3a; border-bottom:1px solid var(--edge); color:#a5c8ff; }
  .modes { padding:8px 16px; display:flex; gap:8px; align-items:center; color:var(--dim); }
  .modes button { background:var(--chip); color:var(--ink); border:1px solid var(--edge); border-radius:6px;
                  padding:4px 12px; cursor:pointer; font:inherit; }
  .modes button.on { border-color:var(--acc); color:var(--acc); }
  main { display:flex; gap:16px; padding:16px; align-items:flex-start; flex-wrap:wrap; }
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:10px; flex:2 1 480px; }
  .cell { background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:10px; cursor:pointer; }
  .cell:hover { border-color:var(--acc); }
  .cell.sel { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc); }
  .cell .addr { color:var(--acc); font-weight:700; } .cell .kind { color:var(--dim); font-size:12px; }
  .dials { margin-top:6px; white-space:pre-wrap; word-break:break-all; }
  .bar { height:8px; background:#1f6feb33; border-radius:2px; margin:3px 0; position:relative; }
  .bar i { position:absolute; inset:0 auto 0 0; background:#58a6ff; border-radius:2px; }
  .bar u { position:absolute; right:4px; top:-2px; font-size:10px; color:var(--dim); text-decoration:none; }
  #links { flex:1 1 220px; background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:10px; }
  #links h2, #panel h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0 0 8px; }
  .lk { padding:2px 0; color:var(--dim); } .lk b { color:var(--ink); }
  #panel { display:none; flex:1 1 340px; background:var(--panel); border:1px solid var(--edge);
           border-radius:8px; padding:12px; position:sticky; top:12px; max-width:460px; }
  #panel .row { margin:8px 0; }
  .mut { color:var(--dim); }
  pre.src { background:#0a0d12; border:1px solid var(--edge); border-radius:6px; padding:8px;
            overflow-x:auto; font-size:12px; white-space:pre-wrap; }
  textarea { width:100%; background:#0a0d12; color:var(--ink); border:1px solid var(--edge);
             border-radius:6px; padding:8px; font:inherit; min-height:64px; }
  button.act { background:var(--chip); color:var(--ink); border:1px solid var(--edge); border-radius:6px;
               padding:5px 14px; cursor:pointer; font:inherit; }
  button.act:hover { border-color:var(--acc); }
  .chip { background:var(--chip); border:1px dashed var(--warn); border-radius:6px; padding:8px; margin:8px 0; cursor:pointer; }
  .chip:hover { border-color:var(--acc); }
  .chip .tag { color:var(--warn); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .chip .cmd { color:var(--ink); font-size:11px; word-break:break-all; margin-top:4px; }
  .chip.copied { border-color:var(--ok); } .chip.copied .tag { color:var(--ok); }
  .reply { border-left:2px solid var(--ok); padding:4px 8px; margin:6px 0; }
  .reply .mut { font-size:11px; }
  select { background:#0a0d12; color:var(--ink); border:1px solid var(--edge); border-radius:6px; padding:4px; font:inherit; }
</style></head><body>
<header>
  <h1>quilt · web projection</h1>
  <span class="kv"><span id="dot"></span><b id="conn">connecting…</b></span>
  <span class="kv">tick <b id="tick">–</b></span>
  <span class="kv">ledger <b id="ledger">–</b></span>
  <span class="kv">tip <b id="tip">–</b></span>
  <span class="kv">cells <b id="ncells">0</b></span>
</header>
<div class="banner">Display layer — this panel cannot change the fabric. Backend ops show as explicit commands below.</div>
<div class="modes">presentation:
  <button id="m-raw" class="on">raw</button>
  <button id="m-dec">decoded</button>
  <button id="m-bars">bars</button>
  <span class="mut">(client-side re-projection only — state stays in your browser)</span>
</div>
<main>
  <div id="grid"></div>
  <div id="links"><h2>links</h2><div id="linklist"></div></div>
  <div id="panel">
    <h2>cell detail</h2>
    <div class="row"><span class="addr" id="p-addr"></span> <span class="mut" id="p-kind"></span></div>
    <div class="row" id="p-dials"></div>
    <div class="row"><div class="mut">source (scanned from the board file):</div><pre class="src" id="p-src"></pre></div>
    <div class="row"><div class="mut">ask the operator (never executes a fabric op):</div>
      <textarea id="p-q" placeholder="question about this cell…"></textarea>
      <div><button class="act" id="p-ask">ask</button> <span class="mut" id="p-askmsg"></span></div></div>
    <div class="row"><h2>replies</h2><div id="p-replies" class="mut">none yet — the operator answers via /tmp/canvas-web-answers.jsonl</div></div>
    <div class="row"><h2>needs a backend change?</h2>
      <div class="mut">click to copy the exact command. nothing here auto-executes.</div>
      <div id="p-chips"></div></div>
  </div>
</main>
<script>
(function () {
  var SOCK = __SOCK__;
  var state = null, mode = "raw", selected = null;
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
  function render() {
    if (!state) return;
    $("tick").textContent = state.tick === null ? "–" : state.tick;
    $("ledger").textContent = state.ledger ? (state.ledger.ok ? "ok" : "UNVERIFIED") : "–";
    $("tip").textContent = state.ledger && state.ledger.tip ? String(state.ledger.tip).slice(0, 10) + "…" : "–";
    $("ncells").textContent = state.cells.length;
    var g = $("grid"); g.innerHTML = "";
    state.cells.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "cell" + (selected === c.addr ? " sel" : "");
      el.innerHTML = '<span class="addr">' + esc(c.addr) + '</span> <span class="kind">' + esc(c.kind || "") + '</span>' +
                     '<div class="dials">' + dialHtml(c) + '</div>';
      el.onclick = function () { select(c.addr); };
      g.appendChild(el);
    });
    var ll = $("linklist"); ll.innerHTML = "";
    if (!state.links.length) ll.innerHTML = '<div class="mut">no links</div>';
    state.links.forEach(function (l) {
      var el = document.createElement("div"); el.className = "lk";
      el.innerHTML = '<b>' + esc(l[0]) + '</b> → <b>' + esc(l[1]) + '</b>';
      ll.appendChild(el);
    });
    if (selected) renderPanel();
  }
  function chipHtml(label, cmd) {
    return { label: label, cmd: cmd };
  }
  function sockCmd(ndjson) {
    var node = 'const net=require("net");const s=net.createConnection(' + JSON.stringify(SOCK) + ');' +
               's.on("connect",()=>s.write(require("fs").readFileSync(0,"utf8")));' +
               's.on("data",(d)=>process.stdout.write(d));';
    var payload = JSON.stringify(ndjson).replace(/'/g, "'\\''");
    return "echo '" + payload + "' | timeout 2 node -e '" + node + "'";
  }
  function renderPanel() {
    var c = state.cells.find(function (x) { return x.addr === selected; });
    if (!c) { selected = null; $("panel").style.display = "none"; return; }
    $("panel").style.display = "block";
    $("p-addr").textContent = c.addr;
    $("p-kind").textContent = c.kind || "";
    $("p-dials").innerHTML = "raw dials: <b>" + esc(JSON.stringify(c.dials)) + "</b>" +
      (decode(c.kind, c.dials) ? '<div class="mut">decoded: ' + esc(decode(c.kind, c.dials).join(" · ")) + '</div>' : "");
    fetch("/cell/" + encodeURIComponent(c.addr)).then(function (r) { return r.json(); }).then(function (s) {
      $("p-src").textContent = s.source_excerpt !== null && s.source_excerpt !== undefined
        ? "// " + s.source_path + (s.source_line ? " :" + s.source_line : "") + "\n" + s.source_excerpt
        : "// " + (s.reason || "no bind line found");
    });
    var chips = $("p-chips"); chips.innerHTML = "";
    var list = [
      chipHtml("re-BIND " + c.addr + " (re-assert these dials)", sockCmd({ type: "opcode", op: "BIND", cell: c.addr, args: { dials: c.dials, kind: c.kind } })),
      chipHtml("TICK the fabric", sockCmd({ type: "opcode", op: "TICK", cell: "graph", args: {} }))
    ];
    var others = state.cells.filter(function (x) { return x.addr !== c.addr; }).map(function (x) { return x.addr; });
    if (others.length) {
      var row = document.createElement("div"); row.className = "chip";
      var sel = document.createElement("select");
      others.forEach(function (a) { var o = document.createElement("option"); o.value = a; o.textContent = a; sel.appendChild(o); });
      var lbl = document.createElement("span"); lbl.className = "tag"; lbl.textContent = " LINK " + c.addr + " → ";
      var go = document.createElement("button"); go.className = "act"; go.textContent = "copy link command";
      var cmd = null;
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
  function copyCmd(cmd, el) {
    function done() {
      var prev = el.className; el.className = prev + " copied";
      var t = el.querySelector(".tag");
      if (t) { var old = t.textContent; t.textContent = "copied ✓ (paste it in a shell — it runs only when YOU run it)"; setTimeout(function () { el.className = prev; t.textContent = old; }, 2500); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd).then(done);
    else { var ta = document.createElement("textarea"); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); }
  }
  function select(addr) {
    selected = addr; render();
    loadReplies();
  }
  function loadReplies() {
    if (!selected) return;
    fetch("/inbox").then(function (r) { return r.json(); }).then(function (ib) {
      var mine = ib.questions.filter(function (q) { return q.addr === selected; });
      var el = $("p-replies");
      if (!mine.length) { el.className = "mut"; el.textContent = "no questions asked yet for " + selected; return; }
      el.className = ""; el.innerHTML = "";
      mine.forEach(function (q) {
        var qd = document.createElement("div");
        qd.innerHTML = '<span class="mut">Q·' + esc(new Date(q.ts).toLocaleTimeString()) + ' ·</span> ' + esc(q.question);
        el.appendChild(qd);
        if (!q.replies.length) { var w = document.createElement("div"); w.className = "mut"; w.textContent = "…awaiting operator"; el.appendChild(w); }
        q.replies.forEach(function (r) {
          var rd = document.createElement("div"); rd.className = "reply";
          rd.innerHTML = '<span class="mut">A·operator</span><br>' + esc(r.reply !== undefined ? r.reply : JSON.stringify(r));
          el.appendChild(rd);
        });
      });
    });
  }
  $("p-ask").onclick = function () {
    var q = $("p-q").value.trim();
    if (!q || !selected) { $("p-askmsg").textContent = "select a cell and type a question"; return; }
    fetch("/ask", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: selected, question: q }) })
      .then(function (r) { return r.json(); })
      .then(function (o) {
        $("p-askmsg").textContent = o.ok ? "logged (ts=" + o.ts + ") — check replies below" : "error: " + o.error;
        if (o.ok) { $("p-q").value = ""; loadReplies(); }
      });
  };
  function setMode(m) {
    mode = m;
    ["raw", "dec", "bars"].forEach(function (k) { $("m-" + k).className = k === m ? "on" : ""; });
    render(); // pure client-side re-projection: no fetch, no server round-trip
  }
  $("m-raw").onclick = function () { setMode("raw"); };
  $("m-dec").onclick = function () { setMode("dec"); };
  $("m-bars").onclick = function () { setMode("bars"); };
  var es = new EventSource("/events");
  es.onopen = function () { $("dot").className = "on"; $("conn").textContent = "live (SSE)"; };
  es.onerror = function () { $("dot").className = ""; $("conn").textContent = "reconnecting…"; };
  es.onmessage = function (e) {
    try { state = JSON.parse(e.data); } catch { return; }
    render();
  };
  setInterval(loadReplies, 5000); // operator replies arrive out-of-band; poll the inbox lightly
})();
</script>
</body></html>`.replace("__SOCK__", sockJson);
}

const server = http.createServer((req, res) => {
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
  } else if (req.method === "GET" && p === "/inbox") {
    json(res, 200, inbox());
  } else {
    json(res, 404, { error: "not found", endpoints: ["/", "/state.json", "/events", "/cell/<addr>", "/ask (POST)", "/inbox"] });
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
