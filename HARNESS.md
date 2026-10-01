# HARNESS.md — mission-command workbench runbook (agent-facing)

This repo's bridge is a two-way instrument: a **controller** owns an authoritative quilt
Fabric (cells, dials, links, receipt chain) behind a unix socket, and any number of
**clients** — boards, canvases, plain shells — drive opcodes in and receive update
broadcasts out. The `cudaclaw_board.mjs` demo binds a live GPU turn-taking run's
receipts as fabric lanes so an operator can watch them light up like a projected
switchboard while any agent mutates the same fabric from a shell.

## Socket convention

- Path: `$QUILT_SOCK`, falling back to `/tmp/quilt-canvas/socks/default.sock`.
- This workbench's convention: `/tmp/quilt-canvas/socks/<board-id>.sock` (e.g. `cudaclaw.sock`).
  The controller creates the directory and unlinks a stale socket before listening.
- Localhost-only filesystem socket, **no auth** — design probe, not a hardened service.
  Anyone with filesystem access drives the fabric. Don't point it at anything sensitive.
- The controller is the single authority. `fleet_board.mjs` is the exception: it is itself
  a dogfood *controller* (it serves its own socket). `cudaclaw_board.mjs` is a *client*.

## Wire protocol (NDJSON, one JSON object per line)

Observed shapes, all verified live on `/tmp/quilt-canvas/socks/cudaclaw.sock`:

| direction | shape | notes |
|---|---|---|
| client → controller | `{"type":"ready","canvas":"<name>","pid":N}` | hello; controller answers with a full update stamped `hello:true` and logs `canvas ready: pid=N` |
| client → controller | `{"type":"opcode","op":"BIND","cell":"A1","args":{"dials":[3,13243,865],"kind":"spool:qwen3.5-0.8b"}}` | args pass straight into the fabric op |
| client → controller | `{"type":"opcode","op":"LINK","cell":"graph","args":{"a":"A1","b":"A5"}}` | both cells must already be bound, else `MISSING_CELL` |
| client → controller | `{"type":"opcode","op":"TICK","cell":"graph","args":{}}` | cell may also be an existing addr |
| client → controller | `{"type":"opcode","op":"VIEW","cell":"A1"}` | pure; response update carries an `inspector` payload |
| client → controller | `{"type":"opcode","op":"FORGET","cell":"Z9"}` | ⚠️ see PoEM gate below — trapdoor |
| controller → all | `{"type":"update","tick":N,"cells":[{addr,dials,kind}...],"links":[[a,b]...],"ledger":{"ok":bool,"len":N,"tip":"<id>"},"inspector"?}` | broadcast to **every** connected client after each opcode; merging clients must rebuild the full fabric from it |
| controller → all | `{"type":"close"}` | on controller SIGINT, then it exits |
| client → controller | `{"type":"pong"}` | canvas.mjs answers `ping` this way; the reference controller never emits `ping` itself |

Note the asymmetry between controllers: `controller.mjs` updates carry a `ledger` object;
`fleet_board.mjs` (dogfood controller) updates carry `gdigest` + `journal` instead.
Clients that want both should default fields (`msg.gdigest ?? msg.ledger?.tip`).

### PoEM gate (what controller.mjs actually does — verified live)

`BIND`, `LINK`, `EFFECT`, `TICK` run through `fabric.gated()`: the receipt chain is
verified first; if it doesn't verify the op is refused with
`{"error":"LEDGER_UNVERIFIED","detail":"[N] receipt_id ... != recomputed ..."}` — and the
refusal is itself receipted and broadcast as a normal update. `VIEW` is direct (pure,
never mutates). `FORGET` is direct too — **but it is a trapdoor**: `fabric.forget()` seals
its receipt with a different formula than `_seal()` uses for every other op, so the
chain verifier cannot recompute it. After one FORGET the ledger never verifies again and
**every subsequent mutation is refused** (verified: `BIND W1` → `LEDGER_UNVERIFIED`).
If you need a fabric to stay writable, restart the controller instead of forgetting cells.

### TICK semantics (matters for boards)

`TICK` increments the tick and drifts every dial: even indexes +1, odd indexes −1,
floored at 0. A board that cares about dial truth re-BINDs after ticking —
`cudaclaw_board.mjs` does exactly this on every spool change.

## Driving it from tmux (exact commands, as run)

```bash
# 1 — controller (owns the fabric + socket). Note the absolute path inside the window:
tmux kill-session -t canvas-ctl 2>/dev/null
tmux new-session -d -s canvas-ctl -n ctl \
  "QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node bridge/controller.mjs 2>&1 | tee /tmp/canvas-ctl.log"

# 2 — FAIL-first pin: wait for the socket, fail loudly if it never appears
for i in $(seq 1 30); do [ -S /tmp/quilt-canvas/socks/cudaclaw.sock ] && break; sleep 0.1; done
[ -S /tmp/quilt-canvas/socks/cudaclaw.sock ] || { echo "FAIL: controller socket never appeared"; exit 1; }

# 3 — the receipt-driven board (client). cd first: tmux windows inherit the CALLER's cwd,
#     so `node bridge/...` with a relative path resolves against wherever you invoked tmux.
tmux new-window -t canvas-ctl -n board "cd /home/eileen/projects/quilt-canvas-tui && \
  CUDA_CLAW_RECEIPTS=/home/eileen/projects/quilt-gpu-lab/results/cudaclaw_spool/receipts.jsonl \
  QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock \
  node bridge/cudaclaw_board.mjs 2>&1 | tee /tmp/canvas-board.log"

# 4 — viewer pane (chiaroscuro TUI grid of the same fabric)
tmux new-window -t canvas-ctl -n view "cd /home/eileen/projects/quilt-canvas-tui && \
  QUILT_SOCK=/tmp/quilt-canvas/socks/cudaclaw.sock node bridge/canvas.mjs; bash"

# 5 — drive it live from any shell (no special CLI needed; cli.mjs has no mutation verb):
echo '{"type":"opcode","op":"BIND","cell":"Z9","args":{"dials":[4200,700],"kind":"probe"}}' | \
  timeout 2 node -e '
    const net = require("net");
    const s = net.createConnection("/tmp/quilt-canvas/socks/cudaclaw.sock");
    s.on("connect", () => s.write(require("fs").readFileSync(0, "utf8")));
    s.on("data", (d) => process.stdout.write(d));
  '
```

Bidirectionality proof captured on 2026-09-30 (all three artifacts):

1. **sent** — `{"type":"opcode","op":"BIND","cell":"Z9","args":{"dials":[4200,700],"kind":"probe-shell-mutation"}}`
2. **executed** — `/tmp/canvas-ctl.log`: `[controller] opcode BIND Z9 -> {"cell":"Z9","dials":[4200,700],"version":1,"created":true}`
3. **received** — `/tmp/canvas-board.log`: `update arrived: tick=2 cells=7 links=5 ledger_ok=true tip=...` (cells 6→7: Z9 arrived)

A second client watching the same socket receives the same broadcast — one shell probe
heard `type=update ... Z9={"addr":"Z9","dials":[4200,700],...}` within 1.2 s, exit clean.

## The board: what it binds

`cudaclaw_board.mjs` reads `$CUDA_CLAW_RECEIPTS` (default
`/home/eileen/projects/quilt-gpu-lab/results/cudaclaw_spool/receipts.jsonl`, JSONL,
one turn per line with `model`, `kind`, `wall_ms`, `spool_ms`, `tok_s`, optional `error`)
and re-reads it every 3 s, so lanes keep lighting up as the spool grows:

- `A1..A4` — one lane per model, first-appearance order, kind `spool:<model-with-dashes>`.
  Dials: `[turns_taken, round(avg_tok_s*100), round(avg_spool_ms/10)]` — uint32 per fabric
  law; turns with an `error` field count as turns but are excluded from averages;
  div-by-zero guards; fewer than four models pads with zero lanes.
- `A5` — summary cell, kind `cudaclaw-board`, pooled dials, every lane LINKs into it.
- Same ops are applied to a local mirror Fabric, then pushed as opcodes. Missing or empty
  receipts file ⇒ FAIL-first warning on stderr, zero-lane placeholders, still running.
- Reconnect: socket error/close ⇒ retry every 2 s, full re-sync on reconnect.

Observed first bind against the live 12-turn spool:

```
[cudaclaw-board] bound lanes: A1=3/13243/865 A2=3/14823/534 A3=3/15740/435 A4=3/2677/1881 A5=12/11621/929
```

(= qwen3.5:0.8b, tev1:0.8b, qwen2.5:0.5b, tev1:4b; cross-checked against the run's
summary.json — tev1:4b is the slow lane at 26.8 tok/s.)

## Viewer pane: what lights up

The `view` window renders the fabric grid; bound lanes show version + dials, the
selected cell's full state renders at the bottom. Every opcode from any client repaints
it within one broadcast. The `board` and `ctl` windows tee to `/tmp/canvas-board.log`
and `/tmp/canvas-ctl.log` — `tail -f` either to watch lanes/receipts without a pane.
Sample capture (80×24):

```
 A1  v5    B1  v3    C1  v0    ...
 [4,13242,*[3]       []
```

## Gotchas (all hit live)

1. **tmux window cwd**: `new-window` inherits the *caller's* cwd, not the session's first
   window's. A relative `node bridge/...` resolved against `~/.openclaw/workspace` and died
   with MODULE_NOT_FOUND. Always `cd <repo> &&` inside the window command.
2. **cli.mjs has no mutation verb** — `show` runs the canvas in-process, `spawn` only
   *prints* a tmux command. Driving the socket means a hand-rolled NDJSON client (5 lines
   of node, above).
3. **FORGET bricks the ledger** (PoEM gate then refuses everything — see above). We now
   know why: `forget()` seals receipts with a different id formula than `_seal()`, so
   `verifyChain()` can't replay receipt N. Fix upstream (verify FORGET receipts) or never
   FORGET on a controller you want to keep mutating.
4. **TICK mutates dials** (+1/−1 alternately). Your dials are not what you bound after a
   tick; re-BIND to reassert truth (the board does).
5. **Flood discipline**: the controller broadcasts to *all* clients per opcode. A probe
   that re-sends or spin-reads will light up every pane at once. Send once, read once,
   exit.
6. **Viewer version counters inflate locally**: each broadcast carries the full links
   list, and `fabric._link()` bumps both endpoints' versions unconditionally even when
   the edge already exists. A canvas that has been merging updates for a while shows
   higher `vN` than the controller's fabric. The controller log is authoritative;
   dial values stay correct.
7. **test_bridge.mjs 9/10**: the failing subtest needs the quilt-c python kernel at
   `/tmp/quilt-c` (`cell_api.py`) — not present in this environment, and `quilt-c` is not
   on PyPI. It is a cross-language byte-match pin, not a bridge defect; all controller/
   socket/fabric behavior tests pass. `test_chiaroscuro.mjs` is 6/6.
