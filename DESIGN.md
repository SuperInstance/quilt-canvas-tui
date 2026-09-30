# QUILT-CANVAS — bidirectional TUI substrate
### big-picture design · 2026-09-30 · for the captain

## The one sentence

**claude-canvas gives the model a display; chiaroscuro gives a substrate a rendering; quilt-c gives every thing an addressable capability. Quilt-canvas is all three at once: the AI's display IS the substrate's rendering, and the channel runs both directions.**

## The three ancestors

| ancestor | what it proved | what we take |
|---|---|---|
| `dvdsgl/claude-canvas` | an AI can *spawn* TUIs in tmux splits and *be spoken back to* over Unix sockets (ready/selected/cancelled → update/close/ping) | the controller/canvas split; skill-driven spawn; `spawn/show` CLI; IPC protocol |
| `SuperInstance/chiaroscuro` | any per-cell decision procedure can be rendered as living text (5 engines: glyph/sculpt/pixel/braille/shape-match); exports freeze the procedure 3 ways | the rendering engine set; "characters are shapes, not pixels"; the substrate-walker frame |
| `SuperInstance/quilt-c` | a spreadsheet where every cell is a live capability, 5+1 opcodes, 1,285 assertions, 12 byte-checked ports | the model of record; BIND/LINK/EFFECT/VIEW/TICK/FORGET; receipt chain; the C99 kernel |

## The synthesis — four layers

### L1 · quilt-tui — the spreadsheet, ported in a variety of ways
A terminal spreadsheet whose cells are quilt cells. Edit = BIND, drag-edge = LINK,
propagate = EFFECT, inspect = VIEW, advance-time = TICK. Ports (the variety is the point):
- **A · Python/curses** — reference port, runs on `cell_api.py` today, zero deps
- **B · Node/ink** — claude-canvas-compatible, IPC-native, Bun-runnable
- **C · C99 + ncurses** — linked against the *actual* quilt-c kernel; the honest port
- **D · ANSI-over-WebSocket** — the same protocol frames in a browser; drives the gh-pages demo

One fabric model, four projections. A port is correct iff it byte-matches the others' receipts.

### L2 · canvas-bridge — the claude-canvas IPC, quilt-flavored
`quilt-canvas spawn sheet --scenario live --config '{fabric}'` → Ink TUI in a tmux split.
Same socket protocol, one addition: the canvas can emit **opcodes**, not just selections.
User clicks a cell → `{type:"opcode", op:"VIEW", cell:"A3"}` → controller (an agent) acts.
Controller pushes `{type:"update", config}` — live re-projection. The canvas is a *peer*, not a display.

### L3 · the workflow quilt — the second panel
General-purpose IDE work projected as a live fabric:
- cells = files / agents / PRs / experiment receipts
- dials = status bytes (merged / gated / red / running)
- LINKs = dependency edges (PR stacks, receipt ancestry, agent→deliverable)
- TICK = wall-clock advance; receipts land as new cells in real time
The right-hand pane of the IDE is no longer a file tree — it is the *quilt projection of the workflow*. This is the panel the captain asked for: claude-canvas on the left, the fabric on the right, same conversation driving both.

### L4 · chiaroscuro bidirectional feed — any feed pushed on, pulled at
Any byte stream (agent logs, receipt chains, telemetry, diffs, even a camera in the terminal port) is PUSHED onto the fabric as cell-dial values, then rendered through chiaroscuro engines:
- glyph ramp ← magnitude; sculpt/bivariate ← activity + change-direction; braille ← log density
- **PULL**: click a rendered cell → the underlying receipt/log/diff opens (VIEW through the rendering)
- **PUSH**: edits in the TUI flow back as opcodes into the fabric — the rendering is also a control surface
Chiaro-scuro was one-way (camera → text). This is two-way: text ⇄ fabric ⇄ feed. Subagents with fleet skills are the walkers; the fabric is the substrate; every frame is a receipt.

## Why this is not three demos stapled together
- The **model of record** is one fabric. All four ports read/write the same opcodes.
- The **receipt chain** (quilt-c's proof discipline) runs under everything: every canvas update is a chained, hash-anchored event.
- The **externalisability gate** discipline carries: each layer ships with "what is real / what is not real" stated up front, and a `--self-test` that asserts the limits.

## Honest ledger (what is NOT real at v0)
- auth on the bridge (claude-canvas has none either; fleet doctrine says fail-closed — the bridge binds localhost only and says so)
- the 4D graph (cell_api.py is flat; L3 projects flat for now)
- pixel/shape-match engines in-band at v0 (glyph + sculpt only; braille for log feeds)
- C port L1-C needs the kernel built; reference is cell_api.py semantics, byte-match promised not yet proven

## Build order (this week)
1. L1-A Python reference + tmux live demo  ← *today*
2. L2 bridge skeleton (Node/ink, socket protocol, spawn/show)
3. L4 feed renderer on glyph+sculpt, one feed: the fleet's own PR/receipt state
4. gh-pages animation for quilt-c (self-contained HTML; JS fabric ticking; no build)
5. L1-C C99 port against the kernel; byte-match check vs A
6. L3 workflow quilt over live fleet state

## The receipt
The first end-to-end receipt: a user BINDs a cell in the Python port; the bridge carries it;
the Node port renders the same fabric; the gh-pages animation replays the same opcode stream;
all four agree byte-for-byte on the state hash. That is the day this stops being a metaphor.

---

## STATUS 2026-09-30 (what is REAL today)

Pinned vocabulary from the fleet (scout-push-simulation): **genome ≠ evidence**
(micrograd-quilt reconciler, MicroInstance) — `cellDigest` (dials+links) is the
genome; journal receipts are per-instance evidence. A projection renders the
genome and never touches evidence — exactly why same fabric → same bytes, now a
stated law rather than an observed pin.

| build-order item | state | evidence |
|---|---|---|
| 1. L1-A Python reference | **DONE** — 10/10 pins | `quilt-tui-py/test_quilt_tui.py` ALL GREEN |
| 2. L2 bridge | **DONE** — 10/10 tests, socket protocol live | `bridge/test_bridge.mjs`; tmux session **`quilt-live`** running now: controller pane + canvas pane, keys driven via `send-keys`, LINK/EFFECT/TICK/VIEW all land in the controller log, VIEW digests match across panes |
| 4. gh-pages animation | **DONE** — single-file, 15/15 structural checks + 9/9 math checks | `ghpages/verify_page.py`, `math_check.js` (receipt chain PASS) |
| 5. L1-C C99 port | **DONE** — 10/10 pins, zero warnings | journal bytes pinned entry-for-entry vs an *independent* Python transcription (`test_bytematch.c` vs `gen_expected_journal.py`); honest model difference documented in `quilt-tui-c/PORTING.md` (kernel scalar model ≠ dial-array model; pinned on journal+FNV, not graph_digest) |
| 6. L3 workflow quilt | designed, not built | next build: editor adapter (tree-sitter imports → LINK; save → BIND; CI → EFFECT) |

### Corrections to the honest ledger (learned by building)
- L1-B shipped as **raw-ANSI Node, zero deps** — not Ink. Dependency-free won; the
  socket protocol is identical to claude-canvas's ready/update/close/ping.
- "byte-match promised not yet proven" for the C port — now proven, on the journal
  byte format + fnv1a64 gdigest. The two cell models (dial-array vs kernel scalar)
  are documented as DIFFERENT, not broken.
- Two real drifts the FAIL-first pins caught, worth teaching: (1) Node `graphDigest`
  must mirror Python **repr** strings (`[2, 1]`, single quotes), not JSON; (2) the
  kernel's cell ids are **borrowed pointers** — a reused driver buffer aliased cells.
  Both are in PORTING.md / test comments.
- Live-demo drifts fixed: spawn-time race (canvas now retries the socket with
  backoff), sync gap (updates now carry **links**, not just cells), keymap
  collision (`l` = move-right everywhere; `L` = link everywhere).

### Where the receipt stands
Python ↔ Node byte-match on the fixed 6-op script: PROVEN (same graph digest).
C journal bytes ↔ independent Python transcription: PROVEN (same bytes).
Node canvas ↔ Node controller over unix socket in live tmux: PROVEN (matching VIEW digests).
The four-way single-session receipt (edit in one port, render in all) remains the
next milestone — needs the editor adapter (M2).
