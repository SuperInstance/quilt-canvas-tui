#!/usr/bin/env node
// pipeline_view.mjs — the tmux mirror of the browser's Pipeline tab: a 2D tiled
// projection of the fabric's cell chains, for agents watching in tmux.
// Zero npm deps (node stdlib only). PEER, never a mutator: reads state only.
//
// Data source: polls http://localhost:8799/state.json every 2s (web_projection's
// authoritative mirror of the controller). If 8799 is down, falls back to reading
// the controller unix socket directly (HARNESS.md idiom: `ready` in, hello update
// out, disconnect — flood discipline: send once, read once, exit).
//
// Run:  node bridge/pipeline_view.mjs [--once]    (--once: render one frame, exit)
// Env:  PIPELINE_HTTP_PORT / PORT (default 8799) · QUILT_SOCK · NO_COLOR
import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";

const HTTP_PORT = parseInt(process.env.PIPELINE_HTTP_PORT || process.env.PORT || "8799", 10);
const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/cudaclaw.sock";
const ONCE = process.argv.includes("--once");
const USE_COLOR = !process.env.NO_COLOR && !process.argv.includes("--no-color");
const POLL_MS = 2000;
const MAX_PATHS = 64;
const MAX_LEN = 32;

// ---- port registry (the single place to edit — exported; the browser Pipeline tab
// in web_projection.mjs imports THIS table so tmux mirror and browser render identically) ----
// A link is VALID (green) iff source.out-port === target.in-port;
// MISMATCH (red + badge) when both are known and differ;
// UNKNOWN (gray, '?') when either cell's kind has no registry entry.
// Schema: single in-port / out-port per kind; `null` = no port on that side.
// NOTE: the fabric stores links UNDIRECTED (mutual neighbors, wire order is
// addr-sorted) — projections orient edges by port flow, not wire order.
export const KIND_PORTS = {
  mic:     { in: null,             out: "analog-audio" },
  a2d:     { in: "analog-audio",   out: "digital-audio" },
  stt:     { in: "digital-audio",  out: "text" },
  llm:     { in: "text",           out: "text" },
  tts:     { in: "text",           out: "digital-audio" },
  d2a:     { in: "digital-audio",  out: "analog-audio" },
  mixer:   { in: "analog-audio",   out: "analog-audio" },
  speaker: { in: "analog-audio",   out: null },
  mem:     { in: "text",           out: "text" },
  net:     { in: "text",           out: "text" },
  engine:  { in: "text",           out: "text" },
};

function portsOf(kind) {
  const p = KIND_PORTS[String(kind ?? "")];
  if (!p) return { in: "?", out: "?", known: false };
  return { in: p.in === null ? "—" : p.in, out: p.out, known: true };
}

// ---- ANSI ----
const col = {
  green: (s) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  gray: (s) => (USE_COLOR ? `\x1b[90m${s}\x1b[0m` : s),
};
const RANK = { none: 0, unknown: 1, match: 2, mismatch: 3 };
const sevColor = (r) => (r === RANK.mismatch ? col.red : r === RANK.match ? col.green : col.gray);

function linkMeta(src, dst) {
  const sp = portsOf(src && src.kind);
  const dp = portsOf(dst && dst.kind);
  if (!sp.known || !dp.known) return { status: "unknown", label: "?" };
  if (sp.out === dp.in) return { status: "match", label: sp.out };
  return { status: "mismatch", label: `${sp.out}≠${dp.in}` };
}

// The controller stores links UNDIRECTED (_link pushes mutual neighbors) and
// broadcasts them as sorted pairs (controller.mjs: `if (c.addr < n)`) — wire
// order is addr sort order, not semantic direction. So orient each edge by
// port flow: if exactly one direction has out(src) === in(dst), project the
// arrow that way. When neither (or both) flow, keep wire order.
function orientLink(a, b, cellMap) {
  const fwd = linkMeta(cellMap.get(a), cellMap.get(b));
  if (fwd.status === "match") return { src: a, dst: b, ...fwd };
  const rev = linkMeta(cellMap.get(b), cellMap.get(a));
  if (rev.status === "match") return { src: b, dst: a, ...rev };
  return { src: a, dst: b, ...fwd }; // mismatch (both known) or unknown
}

// ---- chain extraction: follow out-edges from roots (in-degree 0); cycle-safe ----
function extractChains(cells, links) {
  const cellMap = new Map(cells.map((c) => [c.addr, c]));
  const addrSet = new Set(cells.map((c) => c.addr));
  const out = new Map(cells.map((c) => [c.addr, []]));
  const indeg = new Map(cells.map((c) => [c.addr, 0]));
  const degree = new Map(cells.map((c) => [c.addr, 0]));
  const seenEdge = new Set();
  for (const [a, b] of links) {
    if (!addrSet.has(a) || !addrSet.has(b)) continue;
    degree.set(a, degree.get(a) + 1);
    degree.set(b, degree.get(b) + 1);
    const o = orientLink(a, b, cellMap);
    const k = `${o.src}>${o.dst}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    out.get(o.src).push(o.dst);
    indeg.set(o.dst, indeg.get(o.dst) + 1);
  }
  for (const [, arr] of out) arr.sort();
  const unlinked = cells.map((c) => c.addr).filter((a) => degree.get(a) === 0).sort();

  const paths = [];
  function dfs(addr, path) {
    if (paths.length >= MAX_PATHS || path.length >= MAX_LEN) {
      paths.push(path.slice());
      return;
    }
    path.push(addr);
    const kids = (out.get(addr) || []).filter((k) => !path.includes(k)); // per-path cycle guard
    if (!kids.length) paths.push(path.slice());
    else for (const k of kids) dfs(k, path);
    path.pop();
  }
  const roots = cells
    .map((c) => c.addr)
    .filter((a) => indeg.get(a) === 0 && (out.get(a) || []).length > 0) // edgeless cells are unlinked, not chains
    .sort();
  for (const r of roots) dfs(r, []);

  // cycle-only components (no root reaches them): walk from smallest addr, stop on revisit
  const covered = new Set(paths.flat());
  const unlinkSet = new Set(unlinked);
  const walked = new Set();
  for (const start of cells.map((c) => c.addr).filter((a) => !covered.has(a) && !unlinkSet.has(a)).sort()) {
    if (walked.has(start)) continue;
    const path = [];
    const inPath = new Set();
    let cur = start;
    while (cur && !inPath.has(cur) && path.length < MAX_LEN && !covered.has(cur)) {
      path.push(cur);
      inPath.add(cur);
      walked.add(cur);
      const kids = out.get(cur) || [];
      cur = kids.length ? kids[0] : null;
    }
    if (path.length) paths.push(path);
  }
  return { paths, unlinked };
}

// ---- severity per cell is PER PATH: each chain row tells its own story —
// a cell renders green in the row that carries its matched link and red
// (⚠MISMATCH badge) in the row that carries its mismatch. Unlinked cells
// have no links to tell, so they render gray.

// ---- tiles: each cell a 4-line box; boxes joined by ──label──> arrows ----
function fullBox(cell, sev) {
  const ports = portsOf(cell.kind);
  const badge = sev === RANK.mismatch ? " ⚠MISMATCH" : "";
  const title = `${cell.addr} ${cell.kind ?? "?"}${badge}`;
  const inS = `in:${ports.in}`;
  const outS = `out:${ports.out}`;
  const dialS = `dials:${Array.isArray(cell.dials) && cell.dials.length ? cell.dials.join(",") : "∅"}`;
  const TW = Math.max(title.length, inS.length, outS.length, dialS.length) + 6;
  const mid = (s) => `│ ${s}${" ".repeat(Math.max(0, TW - 4 - s.length))} │`;
  const fill = (s) => "─".repeat(Math.max(0, TW - 5 - s.length));
  const lines = [
    `┌─ ${title} ${fill(title)}┐`,
    mid(inS),
    mid(outS),
    `└─ ${dialS} ${fill(dialS)}┘`,
  ];
  const c = sevColor(sev);
  return { lines: lines.map((l) => c(l)), w: TW };
}

function stubBox(addr, sev = RANK.none) {
  // already rendered above in this frame — compact reference, keeps rows aligned
  const title = `${addr} ↺`;
  const TW = Math.max(title.length, 7) + 6;
  const mid = (s) => `│ ${s}${" ".repeat(Math.max(0, TW - 4 - s.length))} │`;
  const lines = [
    `┌─ ${title} ${"─".repeat(Math.max(0, TW - 5 - title.length))}┐`,
    mid("(see"),
    mid("above)"),
    `└${"─".repeat(Math.max(0, TW - 2))}┘`,
  ];
  return { lines: lines.map((l) => sevColor(sev)(l)), w: TW };
}

function clip(s, n) {
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + "…";
}
function arrowText(meta) {
  if (meta.status === "match") return `──${clip(meta.label, 24)}──>`;
  if (meta.status === "mismatch") return `──✗${clip(meta.label, 20)} MISMATCH──>`;
  return "── ? ──>";
}
function arrowEl(meta) {
  const text = arrowText(meta);
  const c = meta.status === "match" ? col.green : meta.status === "mismatch" ? col.red : col.gray;
  const pad = " ".repeat(text.length);
  // arrow rides line 2 (the out: line — source emits toward target)
  return { lines: [pad, pad, c(text), pad], w: text.length };
}

function chainTiles(path, cellMap, rendered) {
  const n = path.length;
  // links along the path, in path order (paths follow oriented edges)
  const metas = [];
  for (let i = 0; i + 1 < n; i++) metas.push(linkMeta(cellMap.get(path[i]), cellMap.get(path[i + 1])));
  const sevOf = (i) => {
    let s = RANK.none;
    if (i > 0) s = Math.max(s, RANK[metas[i - 1].status] ?? RANK.none);
    if (i < n - 1) s = Math.max(s, RANK[metas[i].status] ?? RANK.none);
    return s;
  };
  const tiles = [];
  path.forEach((addr, i) => {
    if (i > 0) tiles.push(arrowEl(metas[i - 1]));
    tiles.push(
      rendered.has(addr)
        ? stubBox(addr, sevOf(i))
        : ((rendered.add(addr)), fullBox(cellMap.get(addr), sevOf(i)))
    );
  });
  return tiles;
}

// greedy wrap of a tile run into width-bounded visual rows
function renderTiles(tiles, width) {
  const rows = [];
  let cur = [];
  let curW = 0;
  for (const t of tiles) {
    if (cur.length && curW + t.w > width) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(t);
    curW += t.w;
  }
  if (cur.length) rows.push(cur);
  const out = [];
  rows.forEach((row, ri) => {
    const prefix = ri > 0 ? "⤷ " : "";
    for (let i = 0; i < 4; i++) out.push(prefix + row.map((t) => t.lines[i]).join(""));
  });
  return out;
}

function renderFrame(st) {
  const W = process.stdout.columns || 100;
  const cells = st.cells || [];
  const links = st.links || [];
  const cellMap = new Map(cells.map((c) => [c.addr, c]));
  const { paths, unlinked } = extractChains(cells, links);

  const lines = [];
  lines.push(
    `quilt·pipeline  tick=${st.tick ?? "–"}  ledger=${
      st.ledger ? (st.ledger.ok ? "ok" : "UNVERIFIED") : "–"
    }  tip=${st.ledger && st.ledger.tip ? String(st.ledger.tip).slice(0, 12) + "…" : "–"}  ` +
      `cells=${cells.length}  links=${links.length}  via=${st.via}  updated=${st.updated_at ?? "–"}`
  );
  lines.push("");
  lines.push(col.gray(`── chains (${paths.length}) ──`));
  const rendered = new Set();
  if (!paths.length) lines.push(col.gray("(no links — every cell is unlinked)"));
  for (const p of paths) {
    for (const l of renderTiles(chainTiles(p, cellMap, rendered), W)) lines.push(l);
    lines.push(""); // chains stack with a blank line
  }
  if (unlinked.length) {
    lines.push(col.gray(`── unlinked (${unlinked.length}) ──`));
    for (const l of renderTiles(
      unlinked.map((a) => fullBox(cellMap.get(a), RANK.none)),
      W
    )) lines.push(l);
  }
  process.stdout.write(`\x1b[2J\x1b[H${lines.join("\n")}\n`);
}

// ---- data layer: HTTP poll first, unix-socket fallback (HARNESS.md idioms) ----
function fetchHttp() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const req = http.get({ host: "127.0.0.1", port: HTTP_PORT, path: "/state.json", timeout: 1500 }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        try {
          done(JSON.parse(b));
        } catch {
          done(null);
        }
      });
      res.on("error", () => done(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => done(null));
  });
}

function fetchSock() {
  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    const finish = (v) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try {
          s.destroy();
        } catch {}
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), 3000);
    const s = net.createConnection(SOCK);
    s.on("connect", () =>
      s.write(JSON.stringify({ type: "ready", canvas: "pipeline-view", pid: process.pid }) + "\n")
    );
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
          // one shot: take the first full broadcast (hello update is full state), hang up
          finish({
            connected: true,
            tick: msg.tick,
            cells: msg.cells || [],
            links: msg.links || [],
            ledger: { ok: msg.ledger ? msg.ledger.ok : null, tip: (msg.ledger && msg.ledger.tip) || msg.gdigest || null },
            updated_at: new Date().toISOString(),
            via: `sock:${SOCK.split("/").pop()}`,
          });
        } else if (msg.type === "ping") {
          s.write(JSON.stringify({ type: "pong" }) + "\n");
        }
      }
    });
    s.on("error", () => finish(null));
    s.on("close", () => finish(null));
  });
}

async function getState() {
  const st = await fetchHttp();
  if (st && Array.isArray(st.cells)) return { ...st, via: `http:${HTTP_PORT}` };
  return await fetchSock();
}

async function main() {
  const st = await getState();
  if (!st) {
    process.stderr.write(
      `[pipeline-view] FAIL: no state source — http:${HTTP_PORT} down and ${SOCK} unreachable\n` +
        `[pipeline-view] start web_projection.mjs (http) or the controller (sock) first\n`
    );
    process.exit(1);
  }
  renderFrame(st);
  if (ONCE) return;
  setInterval(async () => {
    const s = await getState();
    if (s) renderFrame(s);
  }, POLL_MS);
}

// run the poll/render loop only when executed directly — importing this module
// (e.g. web_projection.mjs reusing KIND_PORTS) must stay side-effect free
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
