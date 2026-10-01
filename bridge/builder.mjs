#!/usr/bin/env node
// builder.mjs — the builder daemon: the "claw session" that lives in the agent panel.
// Tails /tmp/canvas-web-questions.jsonl, thinks with an LLM (Z.ai), BUILDS cells+links
// on the fabric over the unix socket, and replies with a Socratic scope question into
// /tmp/canvas-web-answers.jsonl.
//
// Zero npm deps (node stdlib only). Wire protocol per HARNESS.md:
//   client -> controller: {"type":"opcode","op":"BIND","cell":"E1","args":{"dials":[0,0,0],"kind":"mic"}}
//   controller -> all:    {"type":"update","tick":N,"cells":[...],"links":[...],"ledger":{"ok":true,"tip":..}}
//
// SAFETY: op whitelist is {bind,link,tick,save} — FORGET is REJECTED by design.
// One FORGET seals an unverifiable receipt (PoEM gate trapdoor, issue #1) and bricks
// every later mutation with LEDGER_UNVERIFIED until controller restart. The builder
// never emits it, whatever the model asks for.
//
// Run (tmux): node bridge/builder.mjs 2>&1 | tee /tmp/canvas-builder.log
// Lock: /tmp/canvas-builder.lock (single instance).
import fs from "node:fs";
import net from "node:net";
import { saveRecord } from "./record.mjs"; // portable quilt-record/v1 writer (the SAVE op)

const SOCK = process.env.QUILT_SOCK || "/tmp/quilt-canvas/socks/cudaclaw.sock";
const QUESTIONS_FILE = "/tmp/canvas-web-questions.jsonl";
const ANSWERS_FILE = "/tmp/canvas-web-answers.jsonl";
const LLM_RAW_FILE = "/tmp/canvas-builder-llm.jsonl"; // raw model JSON per turn (docs/audit)
const LOCK_FILE = "/tmp/canvas-builder.lock";
const KEY_FILE = "/mnt/c/Users/casey/key.txt"; // read AT USE-TIME; ZAI_KEY= line; never logged/stored
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODELS = ["glm-5-turbo", "glm-5.3-flash"]; // primary, fallback
const POLL_MS = 1000;
const MAX_CELLS = 64;
const MAX_OPS_PER_TURN = 32;
const OP_TIMEOUT_MS = 5000;
const LLM_TIMEOUT_MS = 120000;
const ALLOWED_OPS = new Set(["bind", "link", "tick", "save"]);
const ADDR_RE = /^[A-Z][0-9]{1,2}$/;

function log(s) {
  process.stderr.write(`[builder ${new Date().toISOString()}] ${s}\n`);
}
function die(msg) {
  log(`FAIL: ${msg}`);
  process.exit(1);
}

// ---------- lock (single instance) ----------
function acquireLock() {
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        die(`another builder (pid ${pid}) holds ${LOCK_FILE}`);
      } catch {
        log(`stale lock (pid ${pid} gone) — taking over`);
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") die(`lock read failed: ${e.message}`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}
acquireLock();
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
    process.exit(0);
  });
}
process.on("exit", () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });

// ---------- jsonl helpers ----------
function readJsonl(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const ln of raw.split(/\r?\n/)) {
    if (!ln.trim()) continue;
    try { out.push(JSON.parse(ln)); } catch { continue; } // partial line mid-write; next read wins
  }
  return out;
}
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

// ---------- socket peer (one-shot sessions: ready -> hello -> work -> close) ----------
// Flood discipline (HARNESS gotcha 5): send once, read once, exit.
function connectSocket() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOCK)) return reject(new Error(`fabric socket missing: ${SOCK}`));
    const s = net.createConnection(SOCK);
    const waiters = [];
    const pending = [];
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const ln = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!ln.trim()) continue;
        let msg;
        try { msg = JSON.parse(ln); } catch { continue; }
        const w = waiters.shift();
        if (w) w.resolve(msg);
        else pending.push(msg);
      }
    });
    s.on("error", (e) => {
      for (const w of waiters.splice(0)) w.reject(e);
      reject(e);
    });
    const api = {
      sock: s,
      write(obj) { s.write(JSON.stringify(obj) + "\n"); },
      next(timeoutMs = OP_TIMEOUT_MS) {
        if (pending.length) return Promise.resolve(pending.shift());
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("socket wait timeout")), timeoutMs);
          waiters.push({ resolve: (m) => { clearTimeout(t); res(m); }, reject: (e) => { clearTimeout(t); rej(e); } });
        });
      },
      close() { try { s.end(); } catch {} },
    };
    s.on("connect", () => resolve(api));
  });
}

async function helloUpdate(c) {
  c.write({ type: "ready", canvas: "builder", pid: process.pid });
  for (;;) {
    const m = await c.next(OP_TIMEOUT_MS);
    if (m.type === "update" && m.hello) return m;
    if (m.type === "ping") c.write({ type: "pong" });
  }
}

// Live fabric state fetch — done before every LLM turn.
async function fetchFabricState() {
  const c = await connectSocket(); // socket-fail propagates: caller logs + exits 1
  try {
    const hello = await helloUpdate(c);
    return {
      tick: hello.tick,
      cells: hello.cells || [],
      links: (hello.links || []).map((l) => [l[0], l[1]]),
      ledgerOk: hello.ledger ? hello.ledger.ok : null,
      ledgerTip: (hello.ledger && hello.ledger.tip) || hello.gdigest || null,
    };
  } finally { c.close(); }
}

// ---------- validation (fail-loud, pre-execution) ----------
// Whitelist {bind,link,tick}; FORGET / LINK-DELETE / anything else is rejected here,
// before any byte reaches the socket.
function validateOps(ops, fabric) {
  const notes = [];
  const valid = [];
  const cells = new Set(fabric.cells.map((c) => c.addr));
  if (!Array.isArray(ops)) return { valid, notes: ["ops field was not an array — nothing executed"] };
  if (ops.length > MAX_OPS_PER_TURN) {
    notes.push(`plan had ${ops.length} ops, capped at ${MAX_OPS_PER_TURN}`);
    ops = ops.slice(0, MAX_OPS_PER_TURN);
  }
  ops.forEach((op, i) => {
    const kind = op && typeof op === "object" ? String(op.op || "").toLowerCase() : "";
    if (!ALLOWED_OPS.has(kind)) {
      notes.push(`op[${i}] REJECTED: "${kind || typeof op}" not in whitelist {bind,link,tick,save}`);
      return;
    }
    if (kind === "save") {
      const tier = op.tier === "full" || op.tier === "hint" ? op.tier : "gist";
      valid.push({ op: "save", tier });
    } else if (kind === "bind") {
      const addr = String(op.addr || "");
      if (!ADDR_RE.test(addr)) { notes.push(`op[${i}] REJECTED: bad addr ${JSON.stringify(op.addr)}`); return; }
      if (!cells.has(addr) && cells.size >= MAX_CELLS) { notes.push(`op[${i}] REJECTED: cell limit ${MAX_CELLS} reached`); return; }
      if (op.dials !== undefined) {
        const d = op.dials;
        if (!Array.isArray(d) || d.length > 8 || !d.every((n) => typeof n === "number" && Number.isFinite(n))) {
          notes.push(`op[${i}] REJECTED: dials must be numeric, ≤8 entries`); return;
        }
      }
      if (op.kind !== undefined && (typeof op.kind !== "string" || op.kind.length > 64 || !op.kind)) {
        notes.push(`op[${i}] REJECTED: kind must be a short string`); return;
      }
      cells.add(addr);
      valid.push({ op: "bind", addr, kind: op.kind ?? "generic", dials: op.dials ?? [0, 0, 0] });
    } else if (kind === "link") {
      const from = String(op.from ?? op.a ?? "");
      const to = String(op.to ?? op.b ?? "");
      if (!ADDR_RE.test(from) || !ADDR_RE.test(to)) { notes.push(`op[${i}] REJECTED: bad link endpoints ${JSON.stringify([op.from, op.to])}`); return; }
      if (!cells.has(from) || !cells.has(to)) {
        notes.push(`op[${i}] REJECTED: link endpoint missing (${!cells.has(from) ? from : to} not bound)`); return;
      }
      valid.push({ op: "link", from, to });
    } else {
      valid.push({ op: "tick" });
    }
  });
  return { valid, notes };
}

// ---------- execution (sequential, each op verified against a fresh broadcast) ----------
function toWire(op) {
  if (op.op === "bind") return { type: "opcode", op: "BIND", cell: op.addr, args: { dials: op.dials, kind: op.kind } };
  if (op.op === "link") return { type: "opcode", op: "LINK", cell: "graph", args: { a: op.from, b: op.to } };
  return { type: "opcode", op: "TICK", cell: "graph", args: {} };
}

async function executeOps(ops) {
  const c = await connectSocket(); // throws on socket-fail: caller logs + exits 1
  const receipts = [];
  try {
    const hello = await helloUpdate(c);
    const cells = new Map(hello.cells.map((x) => [x.addr, x]));
    let links = (hello.links || []).map((l) => [l[0], l[1]]);
    let tick = hello.tick;
    for (const op of ops) {
      if (op.op === "save") {
        // local execution — the record writes to disk, no socket opcode exists for it
        try {
          const r = await saveRecord(op.tier || "gist");
          receipts.push({ ...op, ok: true, detail: `record ${r.tier} → ${r.dir} (cells ${r.cells}, links ${r.links}, tip ${r.ledger.tip})`, tick_after: tick, verified: true, ledger_ok: true, ledger_tip: r.ledger.tip });
        } catch (e) {
          receipts.push({ ...op, ok: false, detail: "save failed: " + e.message, tick_after: tick, verified: false });
        }
        continue;
      }
      const wire = toWire(op);
      c.write(wire);
      const upd = await c.next(OP_TIMEOUT_MS); // controller broadcasts after each opcode
      if (upd.type === "update") {
        tick = upd.tick;
        if (Array.isArray(upd.cells)) for (const x of upd.cells) cells.set(x.addr, x);
        if (Array.isArray(upd.links)) links = upd.links.map((l) => [l[0], l[1]]);
      }
      let ok = false, detail = "";
      if (op.op === "bind") {
        const cell = cells.get(op.addr);
        ok = !!cell && (op.kind === undefined || cell.kind === op.kind);
        detail = cell ? `kind=${cell.kind} dials=${JSON.stringify(cell.dials)}` : "cell absent after broadcast";
      } else if (op.op === "link") {
        // the fabric's links are undirected (fabric._link wires both neighbor lists),
        // so either orientation in the broadcast proves the edge landed
        ok = links.some((l) => (l[0] === op.from && l[1] === op.to) || (l[0] === op.to && l[1] === op.from));
        detail = ok ? "edge present" : "edge absent after broadcast";
      } else {
        ok = typeof tick === "number" && tick > (hello.tick ?? -1);
        detail = `tick=${tick}`;
      }
      receipts.push({
        ...op,
        ok,
        verified: ok,
        detail,
        tick_after: tick,
        ledger_ok: upd.type === "update" && upd.ledger ? upd.ledger.ok : null,
        ledger_tip: upd.type === "update" && upd.ledger ? String(upd.ledger.tip).slice(0, 12) : null,
      });
      if (!ok) log(`op did not verify: ${JSON.stringify(op)} — ${detail}`);
    }
  } finally { c.close(); }
  return receipts;
}

// ---------- LLM (Z.ai) ----------
// Key is read AT USE-TIME from KEY_FILE, held only in this closure's locals for the
// fetch call. It is never logged, echoed, or written anywhere.
function readZaiKey() {
  let raw;
  try { raw = fs.readFileSync(KEY_FILE, "utf8"); }
  catch (e) { throw new Error(`key file unreadable: ${e.code || e.message}`); }
  for (const ln of raw.split(/\r?\n/)) {
    const m = /^ZAI_KEY=(.+)$/.exec(ln);
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error("no ZAI_KEY= line found in key file");
}

async function callModel(messages) {
  const key = readZaiKey();
  let lastErr = null;
  for (const model of MODELS) {
    const t0 = Date.now();
    try {
      const res = await fetch(ZAI_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4000 }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      const bodyText = await res.text();
      const ms = Date.now() - t0;
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
      const data = JSON.parse(bodyText);
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      if (typeof content !== "string" || !content.trim()) throw new Error("empty completion");
      return { model, ms, content, raw: data };
    } catch (e) {
      lastErr = e;
      log(`model ${model} failed (${Date.now() - t0}ms): ${e.message} — trying fallback`);
    }
  }
  throw lastErr;
}

function extractJson(content) {
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

// ---------- system prompt (built fresh each turn, embeds live fabric + contract) ----------
const PORT_REGISTRY = `PORT REGISTRY (kind -> role):
- mic     : captures audio (out: audio)
- a2d     : audio -> digital_audio
- stt     : digital_audio -> text
- llm     : text -> text (language model)
- tts     : text -> digital_audio
- d2a     : digital_audio -> analogue_audio
- speaker : renders analogue audio (in: analogue_audio)
- mem     : text -> text (memory)
- net     : text -> text (internet access)
- engine  : text -> text (agent engine)`;

function buildSystemPrompt(fabric) {
  const state = {
    tick: fabric.tick,
    ledger: { ok: fabric.ledgerOk, tip: fabric.ledgerTip },
    cells: fabric.cells.map((c) => ({ addr: c.addr, kind: c.kind, dials: c.dials })),
    links: fabric.links,
  };
  return `You are the builder agent living inside a quilt-fabric workbench. The human describes a system in plain language. Your job: decompose it into CELLS and LINKS on the fabric, then ask exactly ONE Socratic question that scopes the next step.

You reply with STRICT JSON only — no markdown fences, no prose outside the JSON:
{"ops":[{"op":"bind","addr":"E4","kind":"llm","dials":[0,0,0]},{"op":"link","from":"E3","to":"E4"}],"reply":"what I built and why","question":"the scope question"}

Ops are executed in order. Op forms:
- {"op":"bind","addr":"<ADDR>","kind":"<kind>","dials":[n,...]}  (bind a cell)
- {"op":"link","from":"<ADDR>","to":"<ADDR>"}                    (link a <-> b — links are UNDIRECTED here; one link connects both cells, never emit the reverse of a link you already made)
- {"op":"tick"}                                                  (advance the fabric tick)
- {"op":"save","tier":"gist"}                                    (write a portable quilt-record to disk — use when the user asks to save/export/port the state; tier full|gist|hint)

HARD CONSTRAINTS (violations are silently skipped and reported honestly in your reply):
- Only bind / link / tick / save are allowed. FORGET is banned forever: one FORGET seals an unverifiable receipt and permanently bricks the ledger (PoEM gate trapdoor).
- addr must match ^[A-Z][0-9]{1,2}$ ; max 64 cells total ; dials numeric, max 8 entries ; both link endpoints must already be bound.
- If a request would exceed these caps (e.g. "bind 100 cells"), DO NOT plan the whole thing — reply explaining the cap and ask a scope question proposing a decomposition into lanes of at most 32 ops per turn.

CURRENT FABRIC STATE (live, fetched just now):
${JSON.stringify(state)}

${PORT_REGISTRY}

Craft rules:
- Bind NEW cells at fresh addresses, preferring E1, E2, E3, ... in data-flow order, so the human can watch the system take shape.
- EXTEND, never rebuild: if the fabric already contains cells that fulfill part of the human's ask, bind ONLY the missing cells at the next free addresses (E7 exists → the next new cell is E8) and LINK them into the existing chain. Never re-bind a whole system that already exists and never start a duplicate parallel chain.
- Dials are honest placeholders [0,0,0] — they are model-choice slots, not decoration. Do not invent numbers.
- Pick kind from the PORT REGISTRY when the role matches; otherwise use a short lowercase kind.
- Link cells so data flows through the chain the human described.
- Your reply: 2-4 sentences, what you built and why, in the builder's voice.
- Your question: EXACTLY ONE Socratic question to scope the next step, shaped as an explicit fork. FIRST the SIMPLE path: the fewest concrete choices that make the described system work now — name the model slots the chain actually needs (a voice chain needs exactly three: stt, language model, tts) and wire the hardware; the builder wires the backend. THEN the RICHER path, offered explicitly: what else this edge system could gain — persistent memory, internet access, an agent engine, decomposing a larger agent onto the device. The human should be able to answer in one line.`;
}

// ---------- inbox tail ----------
const answeredTs = new Set(); // question ts values that already have any reply
const processedTs = new Set();
let tailOffset = 0;
let tailBuf = "";
let turnQueue = Promise.resolve();

function loadAnsweredTs() {
  for (const r of readJsonl(ANSWERS_FILE)) {
    for (const k of ["ts", "qts", "question_ts"]) {
      if (Number.isFinite(r[k])) answeredTs.add(r[k]);
    }
  }
}

function pollInbox() {
  let st;
  try { st = fs.statSync(QUESTIONS_FILE); } catch { return; }
  if (st.size === tailOffset) return;
  if (st.size < tailOffset) { // truncated/rotated: rewind, dedup via answeredTs
    tailOffset = 0;
    tailBuf = "";
  }
  const fd = fs.openSync(QUESTIONS_FILE, "r");
  const chunk = Buffer.alloc(st.size - tailOffset);
  fs.readSync(fd, chunk, 0, chunk.length, tailOffset);
  fs.closeSync(fd);
  tailBuf += chunk.toString("utf8");
  const lastNl = tailBuf.lastIndexOf("\n");
  if (lastNl < 0) return; // no complete line yet
  const complete = tailBuf.slice(0, lastNl + 1);
  tailBuf = tailBuf.slice(lastNl + 1);
  tailOffset += Buffer.byteLength(complete);
  for (const ln of complete.split("\n")) {
    if (!ln.trim()) continue;
    let q;
    try { q = JSON.parse(ln); } catch { log(`inbox: unparseable line skipped`); continue; }
    if (typeof q.ts !== "number") { log(`inbox: line without numeric ts skipped`); continue; }
    if (processedTs.has(q.ts)) continue;
    processedTs.add(q.ts);
    if (answeredTs.has(q.ts)) { log(`inbox: skip already-answered question ts=${q.ts}`); continue; }
    const run = turnQueue.then(() => processTurn(q)).catch((e) => log(`turn crashed: ${e.message}`));
    turnQueue = run;
  }
}

// ---------- one turn: think -> validate -> execute -> reply ----------
async function processTurn(q) {
  const t0 = Date.now();
  log(`TURN start ts=${q.ts} q=${String(q.question).slice(0, 90)}`);
  let fabric;
  try { fabric = await fetchFabricState(); }
  catch (e) { die(`socket-fail fetching state before turn: ${e.message}`); }

  const messages = [
    { role: "system", content: buildSystemPrompt(fabric) },
    { role: "user", content: String(q.question) },
  ];

  // think; parse-fail -> exactly one corrective retry -> then answer honestly
  let attempt = null, plan = null, parseErr = null;
  for (let tries = 0; tries < 2 && plan === null; tries++) {
    try { attempt = await callModel(messages); }
    catch (e) {
      await appendAnswer(q, `I could not reach the model backend: ${e.message}`, null, [], { model: MODELS.join("+"), ms: Date.now() - t0 });
      log(`TURN failed (model unreachable) ts=${q.ts}`);
      return;
    }
    log(`model ${attempt.model} answered in ${attempt.ms}ms`);
    appendJsonl(LLM_RAW_FILE, {
      qts: q.ts, at: Date.now(), model: attempt.model, latency_ms: attempt.ms,
      raw_content: attempt.content, finish: attempt.raw?.choices?.[0]?.finish_reason ?? null,
      usage: attempt.raw?.usage ?? null,
    });
    try { plan = extractJson(attempt.content); parseErr = null; }
    catch (e) {
      parseErr = e;
      log(`parse fail (try ${tries + 1}/2): ${e.message}`);
      if (tries === 0) {
        messages.push({ role: "assistant", content: attempt.content.slice(0, 2000) });
        messages.push({ role: "user", content: "That was not valid strict JSON matching the op contract. Reply again with ONLY the JSON object — no fences, no prose." });
      }
    }
  }
  if (plan === null) {
    const head = String(attempt?.content || "").slice(0, 200);
    await appendAnswer(q, `I could not produce a valid build plan (JSON parse failed twice: ${parseErr.message}). Raw model output began: "${head}…"`, null, [], { model: attempt?.model, ms: attempt?.ms });
    log(`TURN failed (unparseable) ts=${q.ts}`);
    return;
  }

  // validate
  const { valid, notes } = validateOps(plan.ops, fabric);

  // execute
  let receipts = [];
  if (valid.length) {
    try { receipts = await executeOps(valid); }
    catch (e) { die(`socket-fail executing ops: ${e.message}`); }
  }

  // reply (honest about skips/failures)
  let reply = typeof plan.reply === "string" && plan.reply ? plan.reply : "(the model gave no reply text)";
  if (notes.length) reply += `\n[builder] ${notes.length} op(s) skipped by validation: ${notes.join("; ")}`;
  const failed = receipts.filter((r) => !r.ok);
  if (failed.length) reply += `\n[builder] ${failed.length} op(s) failed post-execution verification — see ops_applied.`;
  await appendAnswer(q, reply, typeof plan.question === "string" ? plan.question : null, receipts, {
    model: attempt.model, ms: attempt.ms, total_ms: Date.now() - t0,
  });
  log(`TURN done ts=${q.ts} total=${Date.now() - t0}ms ops=${receipts.length}/${valid.length} skipped=${notes.length}`);
}

function appendAnswer(q, reply, question, ops_applied, meta = {}) {
  appendJsonl(ANSWERS_FILE, {
    ts: Date.now(),
    qts: q.ts, // question ts — how /inbox joins replies to questions
    from: "builder",
    reply,
    question,
    ops_applied,
    model: meta.model ?? null,
    latency_ms: meta.ms ?? null,
    total_ms: meta.total_ms ?? null,
  });
  answeredTs.add(q.ts);
  log(`answer appended for qts=${q.ts}`);
}

// ---------- main ----------
log(`builder starting pid=${process.pid} sock=${SOCK}`);
loadAnsweredTs();
try { tailOffset = fs.statSync(QUESTIONS_FILE).size; }
catch { tailOffset = 0; }
log(`tail position ${tailOffset} — answering only questions appended from here on`);
setInterval(() => {
  try { loadAnsweredTs(); pollInbox(); }
  catch (e) { log(`poll error: ${e.message}`); }
}, POLL_MS);
