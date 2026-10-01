#!/usr/bin/env node
// record.mjs — the portable state record: quilt-record/v1. Zero deps. Import-safe.
//
// The record IS the portability unit. One fabric, one file-plus-folder that any
// engine (or spreadsheet, or fresh agent) can read back:
//   full — quilt-record.json (lossless) + README.md (agent-POV) + csv/ views
//   gist — ledger tip + last 20 thread entries + README.md
//   hint — README.md + ledger tip only (what survives a dumb format)
// Essential components (a file without these is NOT a quilt record):
//   cells(addr,kind,dials) + links + ledger tip.
// Dual collection: log = ActiveLog (thread, the rack's front), fabric+ledger =
// ActiveLedger (the back). Both sides ship in every record.
//
// usage from op.mjs: save / since <engine> / load <dir> [--apply] / brief
// usage from web_projection.mjs: `import('./record.mjs')` → renderRecord(tier)
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORD_SCHEMA = 'quilt-record/v1';
const SOCK = process.env.QUILT_SOCK || '/tmp/quilt-canvas/socks/cudaclaw.sock';
const QUESTIONS = '/tmp/canvas-web-questions.jsonl';
const ANSWERS = '/tmp/canvas-web-answers.jsonl';
const CURSOR_DIR = '/tmp/quilt-canvas/cursors';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // repo root
export const RECORDS_DIR = path.join(ROOT, 'records');

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [])
  .filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// ---------- live state (one socket turn, VIEW graph) ----------
export function collectState(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK);
    let buf = '';
    const fail = (e) => { try { s.destroy(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error('socket timeout ' + timeoutMs + 'ms')), timeoutMs);
    s.on('connect', () => s.write(JSON.stringify({ type: 'opcode', op: 'VIEW', cell: 'graph' }) + '\n'));
    s.on('error', fail);
    s.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'update') {
          clearTimeout(timer); s.destroy();
          resolve({ tick: m.tick, ledger: m.ledger, cells: m.cells || [], links: m.links || [] });
          return;
        }
      }
    });
  });
}

// ---------- thread (ActiveLog side) ----------
export function readLog() {
  const seen = new Map();
  for (const q of readJsonl(QUESTIONS)) if (!seen.has(q.ts)) seen.set(q.ts, q);
  const questions = [...seen.values()].map((q) => ({ ts: q.ts, q: q.question || '', from: q.addr || 'you' }));
  const answers = readJsonl(ANSWERS).map((a) => ({
    ts: a.ts, qts: a.qts, from: a.from, reply: a.reply || '',
    ops_applied: a.ops_applied || [], model: a.model ?? null, latency_ms: a.latency_ms ?? null,
  }));
  const answered = new Set(answers.map((a) => a.qts));
  const forks = questions.filter((q) => !answered.has(q.ts)).map((q) => q.q);
  return { questions, answers, forks };
}

// ---------- agent-POV readme (the zeroshot reader's first-class view) ----------
function describeComponents(cells, links) {
  const adj = new Map(cells.map((c) => [c.addr, []]));
  const deg = new Map(cells.map((c) => [c.addr, 0]));
  for (const [a, b] of links) {
    if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  }
  const kind = new Map(cells.map((c) => [c.addr, c.kind]));
  const seen = new Set(); const out = [];
  for (const c of cells) {
    if (seen.has(c.addr)) continue;
    const comp = []; const q = [c.addr]; seen.add(c.addr);
    while (q.length) { const x = q.pop(); comp.push(x); for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); q.push(y); } }
    if (comp.length === 1) { out.push(`- ${c.addr} (${c.kind}) — loose cell`); continue; }
    // linearize greedily from the lowest-addr source-ish node; branches shown with +
    const inComp = new Set(comp);
    let start = comp.find((x) => (deg.get(x) || 0) <= 1 && (adj.get(x) || []).length >= 1) || comp[0];
    const chain = [start]; const inChain = new Set([start]);
    let cur = start;
    while (true) {
      const nxt = (adj.get(cur) || []).find((y) => inComp.has(y) && !inChain.has(y));
      if (!nxt) break; chain.push(nxt); inChain.add(nxt); cur = nxt;
    }
    const leftover = comp.filter((x) => !inChain.has(x));
    out.push(`- ${chain.map((x) => `${x}:${kind.get(x)}`).join(' → ')}` +
      (leftover.length ? `  (+ ${leftover.map((x) => `${x}:${kind.get(x)}`).join(', ')} attached)` : ''));
  }
  return out;
}

export function renderReadme(state, log) {
  const L = [];
  L.push(`# quilt record — the fabric, in its own words`);
  L.push('');
  L.push(`Written ${new Date().toISOString()} · ledger len ${state.ledger.len}, tip \`${state.ledger.tip}\` · tick ${state.tick} · ${state.cells.length} cells, ${state.links.length} links.`);
  L.push('');
  L.push(`I am the record of this fabric. Read me first: this is what is built here, what is still placeholder, what I was asked, and how to re-bootstrap me somewhere else.`);
  L.push('');
  L.push(`## What is built here`);
  L.push('');
  L.push(...describeComponents(state.cells, state.links));
  L.push('');
  const placeholders = state.cells.filter((c) => c.kind === 'generic' || c.kind === 'defect' || /spool/.test(c.kind));
  if (placeholders.length) {
    L.push(`## Honest placeholders (bound but not yet real)`);
    L.push('');
    for (const c of placeholders) L.push(`- ${c.addr}: kind \`${c.kind}\` dials [${c.dials.join(',')}] — model/slot unnamed, do not pretend otherwise.`);
    L.push('');
  }
  const answered = new Set(log.answers.map((a) => a.qts));
  const pairs = log.questions.filter((q) => answered.has(q.ts)).slice(-10);
  if (pairs.length) {
    L.push(`## What I was asked, and what I said (last ${pairs.length})`);
    L.push('');
    for (const q of pairs) {
      const a = log.answers.filter((x) => x.qts === q.ts).slice(-1)[0];
      L.push(`- **Q:** ${q.q}`);
      L.push(`  **A (${a.from}):** ${(a.reply || '').replace(/\s+/g, ' ').slice(0, 400)}${(a.reply || '').length > 400 ? '…' : ''}  _ops: ${a.ops_applied.length}, model ${a.model ?? 'n/a'}_`);
    }
    L.push('');
  }
  if (log.forks.length) {
    L.push(`## Forks I am still waiting on`);
    L.push('');
    for (const f of log.forks.slice(-5)) L.push(`- ${f}`);
    L.push('');
  }
  L.push(`## How to re-bootstrap me`);
  L.push('');
  L.push(`1. Read TUTORIAL-AGENT.md (opcodes, the ask loop, the contracts).`);
  L.push(`2. \`node bridge/op.mjs load <this-record-dir> --dry-run\` — see what would rebind; \`--apply\` converges the live fabric toward this record (rebind-in-place only; FORGET does not exist).`);
  L.push(`3. \`node bridge/op.mjs brief\` — the full route list. Spawning an agent = handing it these routes, not a blank slate.`);
  L.push(`4. Talk to the builder: \`node bridge/op.mjs ask "..." --wait 120\`.`);
  L.push('');
  return L.join('\n');
}

// ---------- the record ----------
export async function renderRecord(tier = 'full') {
  const state = await collectState();
  const log = readLog();
  const base = { schema: RECORD_SCHEMA, generated_at: new Date().toISOString(), tier };
  if (tier === 'hint') {
    return { ...base, ledger: { len: state.ledger.len, tip: state.ledger.tip }, notes: { readme: renderReadme(state, log) } };
  }
  const cut = tier === 'gist' ? 20 : Infinity;
  return {
    ...base,
    fabric: { cells: state.cells.map((c) => ({ addr: c.addr, kind: c.kind, dials: c.dials })), links: state.links },
    ledger: { len: state.ledger.len, tip: state.ledger.tip },
    log: { questions: log.questions.slice(-cut), answers: log.answers.slice(-cut) },
    notes: { readme: renderReadme(state, log) },
  };
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvRow = (arr) => arr.map(csvCell).join(',');

export async function saveRecord(tier = 'full', outDirOpt = null) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = outDirOpt || path.join(RECORDS_DIR, `quilt-${stamp}-${tier}`);
  const rec = await renderRecord(tier);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'quilt-record.json'), JSON.stringify(rec, null, 1) + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), rec.notes.readme);
  if (tier === 'full') {
    const csv = path.join(dir, 'csv');
    fs.mkdirSync(csv, { recursive: true });
    fs.writeFileSync(path.join(csv, 'cells.csv'), ['addr,kind,dials', ...rec.fabric.cells.map((c) => csvRow([c.addr, c.kind, c.dials.join('|')]))].join('\n') + '\n');
    fs.writeFileSync(path.join(csv, 'links.csv'), ['a,b', ...rec.fabric.links.map((l) => csvRow(l))].join('\n') + '\n');
    const ansByQ = new Map(rec.log.answers.map((a) => [a.qts, a]));
    fs.writeFileSync(path.join(csv, 'thread.csv'), ['ts,role,qts,text', ...rec.log.questions.map((q) => {
      const rows = [csvRow([q.ts, 'question', q.ts, q.q])];
      if (ansByQ.has(q.ts)) rows.push(csvRow([ansByQ.get(q.ts).ts, 'reply', q.ts, ansByQ.get(q.ts).reply]));
      return rows.join('\n');
    })].join('\n') + '\n');
  }
  return { dir, tier, ledger: rec.ledger, cells: rec.fabric ? rec.fabric.cells.length : 0, links: rec.fabric ? rec.fabric.links.length : 0 };
}

// ---------- convergent load (diff record vs live; never removes) ----------
export function loadPlan(rec, live) {
  if (!rec || rec.schema !== RECORD_SCHEMA) throw new Error(`not a ${RECORD_SCHEMA} file (got ${rec && rec.schema})`);
  if (!rec.fabric) throw new Error(`tier '${rec.tier}' carries no fabric — load needs a full-tier record (hint/gist are bootstrappers, not restores)`);
  const liveCells = new Map(live.cells.map((c) => [c.addr, c]));
  const liveLinks = new Set(live.links.map((l) => [l[0], l[1]].sort().join('~')));
  const to_bind = []; const conflicts = []; let same = 0;
  for (const c of rec.fabric.cells) {
    const l = liveCells.get(c.addr);
    if (!l) to_bind.push({ addr: c.addr, kind: c.kind, dials: c.dials });
    else if (l.kind !== c.kind || JSON.stringify(l.dials) !== JSON.stringify(c.dials)) conflicts.push({ addr: c.addr, record: { kind: c.kind, dials: c.dials }, live: { kind: l.kind, dials: l.dials } });
    else same++;
  }
  const to_link = rec.fabric.links.filter((l) => !liveLinks.has([l[0], l[1]].sort().join('~')));
  return { to_bind, conflicts, to_link, same, record_ledger: rec.ledger, note: `live has ${live.cells.length} cells; load converges toward the record (rebind-in-place); nothing is ever removed (FORGET banned)` };
}

export async function applyPlan(plan, perTurn = 32) {
  const ops = [
    ...plan.to_bind.map((c) => ({ type: 'opcode', op: 'BIND', cell: c.addr, args: { dials: c.dials, kind: c.kind } })),
    ...plan.to_link.map(([a, b]) => ({ type: 'opcode', op: 'LINK', cell: 'graph', args: { a, b } })),
  ];
  const receipts = [];
  for (let i = 0; i < ops.length; i += perTurn) receipts.push(...await socketTurnChunk(ops.slice(i, i + perTurn)));
  return receipts;
}

function socketTurnChunk(opcodes, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK);
    let buf = ''; const got = [];
    const fail = (e) => { try { s.destroy(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error('socket timeout')), timeoutMs);
    s.on('connect', () => { for (const o of opcodes) s.write(JSON.stringify(o) + '\n'); });
    s.on('error', fail);
    s.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'update') { got.push({ tick: m.tick, ledger: m.ledger }); if (got.length >= opcodes.length) { clearTimeout(timer); s.destroy(); resolve(got); } }
      }
    });
  });
}

// ---------- per-engine read cursors ("everything since the last read BY MY ENGINE") ----------
export function readCursor(engine) {
  const f = path.join(CURSOR_DIR, `${engine}.json`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { len: 0, ts: 0 }; }
}
export function writeCursor(engine, cur) {
  fs.mkdirSync(CURSOR_DIR, { recursive: true });
  fs.writeFileSync(path.join(CURSOR_DIR, `${engine}.json`), JSON.stringify(cur) + '\n');
}
export async function since(engine) {
  const cur = readCursor(engine);
  const state = await collectState();
  const log = readLog();
  const delta = {
    schema: 'quilt-record-delta/v1', engine, since: cur,
    now: { len: state.ledger.len, tip: state.ledger.tip, tick: state.tick },
    fabric_at_tip: { cells: state.cells.map((c) => ({ addr: c.addr, kind: c.kind, dials: c.dials })), links: state.links },
    log_since: {
      questions: log.questions.filter((q) => q.ts > (cur.ts || 0)),
      answers: log.answers.filter((a) => (a.ts || 0) > (cur.ts || 0)),
    },
    note: 'cursor = this engine\'s last read (ledger len + ts). receipt-body streaming from the controller is the follow-up — the ledger surface carries ok/len/tip today; the log is delta-faithful.',
  };
  writeCursor(engine, { len: state.ledger.len, ts: Date.now() });
  return delta;
}

// ---------- spawn orientation (the tunnel through routes) ----------
export function brief() {
  let latest = null;
  try {
    const dirs = fs.readdirSync(RECORDS_DIR).filter((d) => d.startsWith('quilt-')).sort();
    if (dirs.length) latest = path.join(RECORDS_DIR, dirs[dirs.length - 1]);
  } catch {}
  return [
    'op.mjs brief — spawn orientation: the tunnel a fresh agent walks (routes, not a blank slate)',
    '  1. identity         repo README.md — who the crew is, what the fabric is',
    `  2. this fabric      ${latest ? latest + '/README.md' : 'records/ (none yet — run: op.mjs save --tier full)'} — agent-POV: what is built, what is placeholder, open forks`,
    '  3. how to act       TUTORIAL-AGENT.md — opcodes, the ask loop, answer contract',
    '  4. the CLI          node bridge/op.mjs (bind/link/tick/state/cell/ask/inbox/save/since/load/brief)',
    '  5. builder contract bridge/builder.mjs — whitelist {bind,link,tick,save}; FORGET banned forever',
    '  6. live surfaces    http://localhost:8799 (claw | sheet/pipeline/grid | context panel), SSE at /events',
    '  7. portability      PORTING.md — tiers, essential components, cursors, convergent load',
  ].join('\n');
}
