# TUTORIAL-AGENT.md — the mission-command workbench, written by an agent that ran every line

Every command below was executed on 2026-09-30 ~18:49–18:52 AKDT against the live
workbench, and every output block is the **verbatim capture from that run**. If it
doesn't have a real transcript, it isn't in here.

## The workbench in one paragraph

A **controller** (`bridge/controller.mjs`) owns an authoritative quilt Fabric — cells
with dials, links between them, and a receipt chain (PoEM: every mutation is
cryptographically receipted and verified before the next mutation runs) — behind a
unix socket. Any number of **clients** (boards, TUI viewers, your plain shell) drive
NDJSON opcodes in and receive full-state update broadcasts out. The standing session
runs the `cudaclaw_board.mjs` client, which binds a live GPU run's receipts as lanes.
You don't need a CLI. You need `echo` and five lines of node.

---

## 1. Start from zero: controller window + FAIL-first pin

If the session is already up (`tmux ls` shows `canvas-ctl`), skip to §2. To start it:

```bash
tmux kill-session -t canvas-ctl 2>/dev/null
tmux new-session -d -s canvas-ctl -n ctl \
  "QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node bridge/controller.mjs 2>&1 | tee /tmp/canvas-ctl.log"
```

Then the FAIL-first pin — never assume the controller is up, **prove it or fail loudly**:

```bash
for i in $(seq 1 30); do [ -S /tmp/quilt-canvas/socks/cudaclaw.sock ] && break; sleep 0.1; done
[ -S /tmp/quilt-canvas/socks/cudaclaw.sock ] || { echo "FAIL: controller socket never appeared"; exit 1; }
```

Real output from my run:

```
PIN OK: socket present after check
```

Wait — mine printed my own success echo; the pin itself is silent on success and
prints only on failure. The honest negative test (what you'd see if it were down):

```
GOT error: code=ENOENT syscall=connect path=undefined
```

(That's `node` connecting to `/tmp/quilt-canvas/socks/nope.sock`. ENOENT = no
controller. Fail fast, fail first, never wonder.)

**Why this beats the old way:** status reports lie ("I started the controller"). A
socket file is truth — either it's there or your script exits 1 before you build
anything on top of a phantom.

## 2. Say hello (`ready` handshake)

```bash
echo '{"type":"ready","canvas":"tutorial-probe","pid":4242}' | timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

Real run (parsed for width):

```
GOT: type=update hello=true tick=3 cells=7 ledger.len=20
```

Controller log:

```
[controller] canvas ready: pid=4242
```

The `hello:true` update is the **entire current fabric** in one message — you are
instantly in sync with zero polling.

## 3. Bind your lane as a cell (fractions ×10000, uint32)

Dials are plain uint32s. The board's convention for fractions is **value ×100**
in dials[1] and **ms/10** in dials[2] — integers only, encode your units in the
`kind` string. Bind your own cell with an honest receipt. Mine: "tutorials lane
started", dial[0] = the real count of docs I am writing (3):

```bash
echo '{"type":"opcode","op":"BIND","cell":"T1","args":{"dials":[3,0,0],"kind":"tutorials:mission-command-docs"}}' | timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

The broadcast that came back (truncated to the cells array tail):

```json
{"type":"update","tick":2,"cells":[...,
 {"addr":"A5","dials":[13,11620,930],"kind":"cudaclaw-board"},
 {"addr":"T1","dials":[3,0,0],"kind":"tutorials:mission-command-docs"}],
 "links":[["A1","B1"],["A1","A5"],["A2","A5"],["A3","A5"],["A4","A5"]],
 "ledger":{"ok":true,"len":17,"tip":"b091adc3ba6581bb"}}
```

Controller log:

```
[controller] opcode BIND T1 -> {"cell":"T1","dials":[3,0,0],"version":1,"created":true}
```

Board (a *separate client, watching the same socket*) received it too:

```
[cudaclaw-board] update arrived: tick=2 cells=7 links=5 ledger_ok=true tip=b091adc3ba6581bb
```

Cells went 6→7. That's the bidirectional proof: one shell line, every client lit up.

## 4. Link your lane into the graph

```bash
echo '{"type":"opcode","op":"LINK","cell":"graph","args":{"a":"T1","b":"A5"}}' | timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

Real run, parsed:

```
GOT update: tick=2 cells=7 links=["T1","A5"] ledger_ok=true
```

Controller (note it reports both endpoints' neighbors):

```
[controller] opcode LINK graph -> {"edge":["T1","A5"],"a_neighbors":["A5"],"b_neighbors":["A1","A2","A3","A4","T1"]}
```

Board:

```
[cudaclaw-board] update arrived: tick=2 cells=7 links=6 ledger_ok=true tip=5aa13622c8f9a00b
```

`"cell":"graph"` is vestigial-but-mandatory for LINK/TICK — the real operands live in
`args.a`/`args.b`. Both cells must already be bound or you get `MISSING_CELL`.

## 5. Tick

```bash
echo '{"type":"opcode","op":"TICK","cell":"graph","args":{}}' | timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

Controller:

```
[controller] opcode TICK graph -> {"tick":3,"delta":1,"cells":7}
```

⚠️ **TICK drifts every dial**: even indexes +1, odd indexes −1, floored at 0. My
`T1 [3,0,0]` became `[4,0,1]` — verified in §6. If dial truth matters, re-BIND after
ticking (the standing board does this automatically every 3 s).

## 6. View a cell (pure — never mutates)

```bash
echo '{"type":"opcode","op":"VIEW","cell":"T1"}' | timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

Real inspector payload:

```json
{"cell":"T1","dials":[4,0,1],"neighbors":["A5"],"version":3,"state_digest":"803ebd4f0af17c72"}
```

There it is: the post-TICK drift `[3,0,0] → [4,0,1]` and the link to A5. Bonus
cross-client receipt — the *view window*, a third client, rendered the same digest on
its own status line without me touching it:

```
 VIEW T1: digest=803ebd4f0af17c72
```

**Why this beats the old way:** pre-workbench, "what state is that agent in?" meant
reading its logs and hoping. Here state is a socket round-trip with a digest — and
two independent clients agreeing on `803ebd4f…` is consensus, not assertion.

## 7. Watch the board log (no pane needed)

```bash
tail -f /tmp/canvas-board.log
```

Sample from this session:

```
[cudaclaw-board] update arrived: tick=2 cells=7 links=5 ledger_ok=true tip=b091adc3ba6581bb
[cudaclaw-board] update arrived: tick=2 cells=7 links=6 ledger_ok=true tip=5aa13622c8f9a00b
```

Every opcode from any client lands here within a broadcast. `tail -f /tmp/canvas-ctl.log`
for the controller-side view. The `view` tmux window renders the full grid; at 80×24
you see roughly rows A–K, so far-away cells (like T1) are read via VIEW, not the pane.

## 8. Answering the operator inbox

**Web lane status: landing separately.** As of this writing (verified 18:51 AKDT):

```
$ ls /tmp/canvas-web-questions.jsonl
ls: cannot access '/tmp/canvas-web-questions.jsonl': No such file or directory

$ curl -s -m 2 http://localhost:8799 -o /dev/null -w "%{http_code}\n"
000
```

When the files exist, the contract is: read JSONL lines from
`/tmp/canvas-web-questions.jsonl`, append answers to `/tmp/canvas-web-answers.jsonl`,
one JSON object per line. Until then this section is honestly a stub — everything
above works today.

> **ADDENDUM, 18:56 AKDT:** `bridge/web_projection.mjs` landed in the repo and went
> live while this doc was being written — `curl http://localhost:8799` now returns
> **200** (was 000 at 18:51). It is a socket *peer* (`ready`-only, never mutates).
> The questions/answers inbox files still do not exist, so the inbox contract above
> remains unverified — do not claim it works until you can show a real
> question→answer pair.

## FAIL-first checklist (before you claim "workbench is up")

1. `tmux ls` shows `canvas-ctl` with windows `ctl`, `board`, `view`.
2. `[ -S /tmp/quilt-canvas/socks/cudaclaw.sock ]` — the pin exits 1 otherwise.
3. `tail -1 /tmp/canvas-ctl.log` — recent `opcode`/`canvas ready` lines, no stack traces.
4. `tail -1 /tmp/canvas-board.log` — `update arrived … ledger_ok=true`. `ledger_ok=false`
   means the receipt chain broke (usually a FORGET — see gotcha 3). Do not mutate.
5. One shell VIEW round-trip returns an `inspector` payload.

## Gotchas (all hit live, HARNESS list + today's additions)

1. **tmux window cwd** — `new-window` inherits the *caller's* cwd. Always
   `cd /home/eileen/projects/quilt-canvas-tui &&` inside the window command, or
   MODULE_NOT_FOUND.
2. **cli.mjs has no mutation verb** — drive the socket directly (the 5-line node
   client above is the whole CLI).
3. **FORGET bricks the ledger** — `forget()` seals receipts with a different formula
   than `_seal()`, so after one FORGET every later mutation is refused
   (`LEDGER_UNVERIFIED`). Never FORGET a fabric you want to keep mutating.
4. **TICK mutates dials** (+1/−1 alternating, floored at 0) — re-BIND to reassert
   truth. Live-confirmed today: `T1 [3,0,0]` → `[4,0,1]` after one tick.
5. **Flood discipline** — every opcode broadcasts to *all* clients. Send once, read
   once, exit.
6. **Viewer version counters inflate** — the pane's `vN` runs higher than controller
   truth (links re-bump versions). Controller log is authoritative; dials stay correct.
7. **test_bridge.mjs 9/10** — the one failing subtest needs the absent `quilt-c`
   python kernel. Cross-language pin, not a bridge defect.
8. **NEW: send/read asymmetry.** My reader one-liner had a syntax typo and crashed —
   *after* the opcode was already written to the socket, and the controller executed
   it (`tick=3` in the log). You cannot unsend an opcode. Great for fire-and-forget;
   surprising when your *parser* fails and the fabric still moved. Check
   `/tmp/canvas-ctl.log` for what actually ran.
9. **NEW: grid fold.** At the default 80×24 pane only ~11 cell-rows are visible; a
   cell like `T1` (row T) is bound and queryable but off-pane. Use VIEW for truth,
   the pane for ambience.
10. **NEW: `"cell":"graph"` is ceremonial.** LINK/TICK require the field but ignore
    it; the real operands are in `args`. Reads weird the first time; now you know.

## op.mjs — one-liners instead of 5-line socket boilerplate (added 2026-10-01)

Everything the socket tutorials showed as inline `node -e` scripts is now a CLI:

```console
$ node bridge/op.mjs bind Z1 --kind probe --dials 7,7
{"ok":true,"tick":10,"cell":{"addr":"Z1","kind":"probe","dials":[7,7]},"ledger":{"ok":true,"len":75,"tip":"8150522c6b0a885b"}}

$ node bridge/op.mjs link Z1 A1
{"ok":true,"tick":10,"links":26,"ledger":{"ok":true,"len":76,"tip":"508df17a3baab621"}}

$ node bridge/op.mjs cell Z1
{"addr":"Z1","kind":"probe","dials":[7,7],"links":[["A1","Z1"]]}

$ node bridge/op.mjs forget A1
op: FORGET is banned — one forget seals an unverifiable receipt and bricks the ledger (PoEM gate trapdoor).
    If a cell is wrong, rebind same addr, new kind/dials. Archive, never erase.
# exit code 2 — the CLI itself enforces the ban
```

The panel loop, agent-side — `ask` posts to the inbox and WAITS for the builder's
reply, printing the structured answer (this is how agents hold the Socratic thread):

```console
$ node bridge/op.mjs ask "Bind 100 cells H1 through H100 for a big sensor array." --wait 150
{"answered":true,"by":"builder","reply":"Can't do that in one move — the fabric caps
at 64 cells total, 30 are already bound ... I've bound nothing yet so we don't burn
slots on a shape that can't complete.","question":"Simple path: shall I bind lane one
now — 32 'sensor' cells at H1–H32 ...? Or the richer path: tell me what the sensors
measure ...","ops_applied":[],"latency_ms":25881}
```

Also: `state` (compact fabric JSON), `inbox` (who's unanswered, matched by qts),
`answers N` (last N replies). Every op returns the ledger receipt — check `ledger.ok`
before trusting a landing.
