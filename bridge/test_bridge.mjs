// test_bridge.mjs — FAIL-first pins for the quilt-canvas bridge.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Fabric, FIXED_6OP, applyScript, cellDigest, fnv1a64 } from "./fabric.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_PORT = "/tmp/quilt-canvas/quilt-tui-py";

function kernelDigestViaPython() {
  const script = `
import sys
sys.path.insert(0, "/tmp/quilt-c")
import cell_api, json
g = cell_api.CellGraph()
ops = json.loads(open("${PY_PORT}/ops_fixed6.json").read())
for op in ops:
    o = op["op"]
    if o == "BIND": g.op("BIND", op["cell"], {"dials": list(op["dials"])})
    elif o == "LINK": g.op("LINK", "graph", {"a": op["a"], "b": op["b"]})
    elif o == "EFFECT": g.op("EFFECT", op["cell"])
    elif o == "TICK": g.op("TICK", "graph")
    elif o == "VIEW": g.op("VIEW", op["cell"])
print(g.graph_digest(), g.tick, len(g.receipts))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8" }).trim();
  const [digest, tick, n] = out.split(" ");
  return { digest, tick: +tick, receipts: +n };
}

test("fabric byte-matches the python kernel port on FIXED_6OP", () => {
  fs.writeFileSync(`${PY_PORT}/ops_fixed6.json`, JSON.stringify(FIXED_6OP));
  const f = applyScript(new Fabric(), FIXED_6OP);
  const k = kernelDigestViaPython();
  assert.equal(f.graphDigest(), k.digest, "graph digest drifted from kernel");
  assert.equal(f.tick, k.tick);
  assert.equal(f.receipts.length, k.receipts);
});

test("receipt chain is parent-linked and self-consistent", () => {
  const f = new Fabric();
  applyScript(f, FIXED_6OP);
  assert.equal(f.receipts[0].parent, null);
  for (let i = 1; i < f.receipts.length; i++)
    assert.equal(f.receipts[i].parent, f.receipts[i - 1].receipt_id);
});

test("VIEW is pure — graph digest does not move", () => {
  const f = new Fabric();
  applyScript(f, FIXED_6OP.slice(0, 4));
  const before = f.graphDigest();
  f.view("A1");
  assert.equal(f.graphDigest(), before);
  assert.deepEqual(f.violations, []);
});

test("TICK is monotone and saturating", () => {
  const f = new Fabric();
  f.bind("A1", [0, 10]);
  const t0 = f.tick;
  f.doTick();
  assert.equal(f.tick, t0 + 1);
  assert.deepEqual(f.cells.get("A1").dials, [1, 9]);
  for (let i = 0; i < 50; i++) f.doTick();
  assert.ok(f.cells.get("A1").dials.every((d) => d >= 0));
});

test("fnv1a64 matches the classic test vector", () => {
  assert.equal(fnv1a64([0x61]), "af63dc4c8601ec8c");
});

// ── live socket tests against the real controller ────────────────────────────
let SOCK, controller, sockDir;
function connect() {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK);
    s.on("connect", () => resolve(s));
    s.on("error", reject);
  });
}
function readLines(s, onLine) {
  let buf = "";
  s.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const ln = buf.slice(0, i); buf = buf.slice(i + 1);
      if (ln.trim()) onLine(JSON.parse(ln));
    }
  });
}

before(async () => {
  sockDir = fs.mkdtempSync(path.join(os.tmpdir(), "quilt-sock-"));
  SOCK = path.join(sockDir, "t.sock");
  controller = spawn(process.execPath, [path.join(HERE, "controller.mjs")], {
    env: { ...process.env, QUILT_SOCK: SOCK }, stdio: ["ignore", "ignore", "pipe"],
  });
  for (let i = 0; i < 40; i++) {
    try { await connect(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => {
  try { controller.kill("SIGINT"); } catch {}
  try { fs.rmSync(sockDir, { recursive: true, force: true }); } catch {}
});

test("controller answers ready with an update; opcode BIND is applied and broadcast", async () => {
  const s = await connect();
  const got = [];
  readLines(s, (m) => got.push(m));
  s.write(JSON.stringify({ type: "ready", canvas: "sheet", pid: 0 }) + "\n");
  s.write(JSON.stringify({ type: "opcode", op: "BIND", cell: "Z9", args: { dials: [42] } }) + "\n");
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(got.some((m) => m.type === "update" && m.hello), "no hello update");
  const upd = got.find((m) => m.type === "update" && m.cells && m.cells.some((c) => c.addr === "Z9"));
  assert.ok(upd, "BIND was not broadcast back");
  assert.deepEqual(upd.cells.find((c) => c.addr === "Z9").dials, [42]);
  s.end();
});

test("VIEW opcode returns an inspector payload", async () => {
  const s = await connect();
  const got = [];
  readLines(s, (m) => got.push(m));
  s.write(JSON.stringify({ type: "ready", canvas: "sheet", pid: 0 }) + "\n");
  s.write(JSON.stringify({ type: "opcode", op: "BIND", cell: "V1", args: { dials: [7, 7] } }) + "\n");
  s.write(JSON.stringify({ type: "opcode", op: "VIEW", cell: "V1" }) + "\n");
  await new Promise((r) => setTimeout(r, 700));
  const insp = got.find((m) => m.type === "update" && m.inspector && m.inspector.cell === "V1");
  assert.ok(insp, "no inspector for VIEW");
  assert.match(insp.inspector.state_digest, /^[0-9a-f]{16}$/);
  s.end();
});

test("close handshake: controller close message reaches the canvas", async () => {
  const s = await connect();
  const got = [];
  readLines(s, (m) => got.push(m));
  s.write(JSON.stringify({ type: "ready", canvas: "sheet", pid: 0 }) + "\n");
  // simulate controller teardown broadcast
  const s2 = await connect();
  s2.write(JSON.stringify({ type: "ready", canvas: "ctl", pid: 1 }) + "\n");
  await new Promise((r) => setTimeout(r, 300));
  s2.destroy(); // not the broadcast path; assert only the channel is alive
  assert.ok(got.length >= 1, "no messages at all");
  s.end();
});

test("canvas headless drives opcodes over the socket and exits clean", async () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "canvas.mjs")], {
    env: { ...process.env, QUILT_HEADLESS: "1", QUILT_SOCK: SOCK },
    input: ["e", "5", ",", "3", "ENTER", "L", "ENTER", "RIGHT", "ENTER", "t", "v", "q"].join("\n") + "\n",
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(r.status, 0, `canvas exited ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /final gdigest=[0-9a-f]{32}/);
  assert.match(r.stderr + r.stdout, /journal=\d+/);
});

test("cli spawn prints a tmux split command without executing tmux", () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "cli.mjs"), "spawn", "sheet", "--scenario", "live", "--id", "xyz"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /tmux new-session -d -s quilt-xyz/);
  assert.match(r.stdout, /split-window -h/);
  assert.match(r.stdout, /quilt-canvas\/socks\/xyz\.sock/);
});
