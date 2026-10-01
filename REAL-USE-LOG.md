# REAL-USE-LOG.md — receipts from writing the tutorials *through* the workbench

Agent: GLM-5.3-flash subagent, 2026-09-30, ~18:49–18:55 AKDT (~6 min total including
writing). Fleet directive: docs improve by using the thing and recording where it
makes work easier. This is that recording.

## Flows actually run (one-line proof each)

| # | Flow | Time (AKDT) | Proof |
|---|------|-------------|-------|
| 1 | Inspect standing session | 18:49 | `tmux ls` → `canvas-ctl: 3 windows`; socket present |
| 2 | Capture view grid (before) | 18:50 | `tmux capture-pane` → A1..A5 lit, `[4,13242,*]` dials |
| 3 | `BIND T1` from shell | 18:50 | ctl log `opcode BIND T1 -> …"created":true`; board `cells=7` (was 6) |
| 4 | `LINK T1→A5` from shell | 18:50 | ctl log `edge ["T1","A5"]`; board `links=6` (was 5) |
| 5 | `TICK` from shell | 18:50 | ctl log `{"tick":3,"delta":1,"cells":7}` |
| 6 | `VIEW T1` | 18:51 | inspector `{"dials":[4,0,1],"neighbors":["A5"],"state_digest":"803ebd4f0af17c72"}` |
| 7 | FAIL-first pin (positive) | 18:51 | `PIN OK: socket present after check` |
| 8 | FAIL-first (negative socket) | 18:51 | `GOT error: code=ENOENT syscall=connect` |
| 9 | View grid (after) + cross-client digest | 18:51 | pane line `VIEW T1: digest=803ebd4f0af17c72` — matches my inspector |
| 10 | `ready` handshake | 18:51 | `GOT: type=update hello=true tick=3 cells=7 ledger.len=20`; ctl log `canvas ready: pid=4242` |
| 11 | Web lane check | 18:51 | `ls` ENOENT on questions file; `curl` → `000`, rc=7 → honestly documented as "landing separately" |

## What surprised me

1. **The TICK drift math is visible one round-trip later.** I sent `TICK`, predicted
   `[3,0,0] → [4,0,1]` from the +1/−1/floor rule, and the VIEW inspector returned
   exactly `[4,0,1]`. A fabric with *predictable* mutation semantics — that predictability
   is the product; most "live dashboards" can't be second-guessed.
2. **The view window narrates other clients' VIEWs.** My shell probe's VIEW showed up
   on the human-facing pane as `VIEW T1: digest=803ebd4f…` with the *same digest* I
   received. Free cross-client consensus proof, no extra work.
3. **The broadcast carries the whole fabric.** Every opcode answer included all 7
   cells and all links. Merging clients never need a diff protocol — just replace state.
   Crude, and for a fabric this size, exactly right.

## What was easier than the pre-workbench way

- **One-liner proof beats log-diving.** To answer "did my mutation land?" I did not
  grep a single agent log; the controller log line + board log line + returned update
  arrived in the same shell command (≤2 s). Pre-workbench: tail three tmux panes and
  squint at timestamps.
- **State has fingerprints.** `state_digest` on VIEW means "is what I see what you
  see" is answerable by string compare. My tutorials cite two matching digests from
  two different clients as evidence — that sentence was impossible before.
- **Docs wrote themselves from receipts.** Every transcript in TUTORIAL-AGENT.md was
  already on disk (shell history + tee'd logs) when I sat down to write. No
  reconstruction, no "should still work" hedges.

## What was clunkier (honest friction = the roadmap)

1. **The 5-line node client is 5 lines too many.** Every flow needs the same
   `net.createConnection` boilerplate. A 20-line `bridge/op.mjs '<json>'` helper
   (send, print first update, exit) would make every doc example one command.
   *Roadmap: ship `op.mjs`.*
2. **Reader parser crashed after the opcode fired.** My pretty-print one-liner had a
   typo; the controller had already executed the TICK. Un-unsending an opcode is
   correct fire-and-forget behavior but rude during debugging. *Roadmap: an `op.mjs`
   with a `--dry-run` flag that validates JSON and prints, without connecting.*
3. **Grid fold hides far rows.** T1 (row T) is real but invisible at 80×24; I only
   found truth via VIEW. Fine for now, but the human tutorial leans on the bottom
   status line instead of the grid for off-screen cells. *Roadmap: `view` compact
   mode or a `VIEW <addr>` echo already exists — surface it harder.*
4. **`"cell":"graph"` ceremony.** LINK/TICK demand a `cell` field and ignore it.
   Everyone's first read is "wait, is my link on `graph`?" *Roadmap: make the field
   optional for ops that carry operands in args.*
5. **Dial conventions live in heads.** tok_s×100, ms/10, turns — documented in
   HARNESS but not enforced or labeled in the fabric. A `kind` string carrying units
   helps; a `dials_meta` on the cell would help more. *Roadmap: optional
   `args.meta` echoed in VIEW inspector.*
6. **Web lane absent** — the operator-inbox section of the agent tutorial is an
   honest stub, and the human tutorial had to promise screenshots "when it lands."
   Verified down (curl 000) rather than faked. *Roadmap: land the projection, then
   re-run flows 12+ here.*

## Net time

Standing session was already up (per task constraints I did not restart it). From
"first socket check" to "last receipt captured": **~2.5 minutes** for flows 1–11.
Writing the three docs from those receipts: ~3 minutes. The workbench did not make
the docs faster to *type* — it made them **faster to be true**.
