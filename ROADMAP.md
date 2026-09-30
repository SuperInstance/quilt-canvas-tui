# ROADMAP.md — the motion we are in (2026-09-30)

> Doctrine: **we are building something bigger than a given repo.** A repo is
> a lane's barracks; the fleet is the unit. Repos cross-pollinate; skills
> migrate across abstractions; every artifact carries its own receipts.

## The five motions and their state

### M1 — The portable fabric (spreadsheet → substrate probe)
Prove one opcode surface (BIND/LINK/EFFECT/VIEW/TICK/FORGET) across:
- [x] **Python** (`quilt-tui-py/`) — dial-array model, byte-matched to
  `cell_api.py` graph digest. 10/10 pins.
- [x] **Node** (`bridge/`) — byte-matches Python on the fixed 6-op script;
  live unix-socket controller+canvas; tmux two-pane demo RUNNING
  (session `quilt-live`). 10/10 tests.
- [x] **C99** (`quilt-tui-c/`) — the *kernel's* scalar model via the real
  `/tmp/quilt-c` engine; journal bytes pinned entry-for-entry against an
  independent Python transcription. 10/10 pins, zero warnings.
- [x] **gh-pages** (`ghpages/`) — same fabric animated in-browser; fnv1a64 +
  sha256 implemented natively; simulated projection, real math (stated on page).
- [ ] **Go/Zig/Mojo** — README-ledger items, not started. Each teaches one
      thing (Go: channels as LINK; Zig: comptime as VIEW; Mojo: SIMD dials).

### M2 — The claude-canvas-style TUI (quilt as the IDE's second panel)
Design target: general-purpose IDE work where the workflow itself is
projected onto the quilt — files as cells, imports as links, tests as
effects, builds as ticks, diffs as views. Built on the Lane B socket
protocol (controller = editor/driver, canvas = projection).
- [x] socket protocol + live demo
- [ ] editor adapter: emit BIND/LINK from a real editing session
      (tree-sitter import graph → LINK edges; save → BIND version bump;
      test run → EFFECT; build → TICK). NEXT BUILD, one evening.
- [ ] workflow projection mode: cells = work units (issues/PRs), dials =
      state (open/in-review/green), EFFECT = CI signal, VIEW = digest of a
      lane's health. This is the *IDE for the fleet itself*.

### M3 — Chiaroscuro bidirectional feeds (any feed ⇄ subagents with skills)
- [x] spawn path restored (was gateway-dead; Scout F running again)
- [ ] feed adapter skeleton: a feed item (chat msg, issue, CI line) becomes a
      fabric op; subagent results return as EFFECT receipts. The quilt is the
      *exchange format between humans, agents, and feeds*.
- [ ] skill-carrying subagents: task prompt + relevant quilt-skills
      (cross-abstraction patterns) + receipt discipline.

### M4 — The experiment lanes (snowball/qcells style)
- exp034 sealed `ce6605a` (pair-gate pre-registration, 552 tests).
- exp035 CLOSED the pair lane: FAMILY-PAIR-HAZARD RETAINED, zero trips,
  `017c288` local. exp029's pooled REFUTED decomposes below pair resolution.
- [ ] exp036: calibrate ledger confidence vs replay truth (papers §1).
- [ ] Casey queue: read the exp029-vs-exp033/035 tension face.
- BLOCKER: push dead (creds wiped 9/29) — KEY ROTATION; ~9 branches local.

### M8 — Writings that outlast the lane (captain's order, 2026-09-30)
- [x] **AI-Writings PR #71** (branch quilt-canvas-writings-2026-09-30, pushed):
  - `essays/2026-09-30-the-genome-and-the-evidence.md` — flagship essay: the
    genome≠evidence law, the four June walls as evidence it keeps being
    rediscovered, what the law forbids.
  - `essays/2026-09-30-receipts-in-questions-out.md` — technical paper:
    conservation law for agent fleets, instrument = fabric+journal, exp034/035
    paired-gate case study, exp036 as priced falsifiable conjecture, related
    work to June strata. Marked SHAPED not HEWN, says why.
  - `THE_MARK_OF_THE_SHARD_MASON.md` — story: the rotating stranger, the four
    marks, a first mark that is a SCARF rather than lumber.
  - `THE_PROJECTION_SHANTY.md` — work shanty for the canvas crew, call+response.
  - `2026-09-30-the-morning-the-glyph-spoke.md` — slice of the 06:59 shift.
- [ ] Casey merges #71.

### M7 — Push-simulation scout (what the fleet is thinking tonight)
- [x] `scout-push-simulation.md` — five builders simulated from commit
  narratives (gh CLI restored): lucineer (superinstance-api = the PULL side
  of the captain's bidirectional vision — intents-as-cells is now unblocked),
  micrograd-quilt reconciler (**genome ≠ evidence** — cellDigest vs journal,
  priced our projection determinism in one sentence), exoj folder (continuous
  Field = the substrate our chiaroscuro engines were built to render;
  field-dump→dial adapter is the cheap next build), legibility campaign
  (15 PRs, nothing-existing-modified — our TUI is the live version of their
  thesis), keeper/Mavis packaging wave.
- [x] DESIGN.md: genome≠evidence vocabulary pinned.
- [ ] Next builds ranked in scout file: intents-as-cells → exoj→chiaroscuro
      adapter → LEGIBILITY.md pass on graduation.

### M6 — Old-experiment deep-understanding (captain's order, 2026-09-30)
- [x] Strata survey: 128 experiment repos; page-4 June stratum deep-read.
  Deliverable: `scout-old-experiments.md` — four load-bearing monuments
  (entropy-conservation, agent-ensemble, metal-lathe, oxide family) each:
  what they were doing (understood) + quilt-native upgrade (priced).
- Key finding: the June builders independently built the quilt's four walls
  (certainty math, emergence proof, research wheel, machines) — each missing
  the substrate the fabric now provides. "Next level" = complete them,
  not resurrect them.
- exp036 UPGRADED: dH/dt over MicroMoth-quilt PR history — entropy-conservation
  law on our own ledger (law named, instrument exists, data exists).
- Ranked next-level builds (in scout file): exp036 → ensemble-on-real-pulses →
  lathe-as-fabric → oxide invariant pin. All one-session, FAIL-first.

### M5 — Agent-process ethnography (quilt-skills from another abstraction)
- [x] Scout H: claude-canvas protocol extraction — `scout-claude-canvas.md`
  (full NDJSON protocol table; no auth anywhere; controller-as-server mode;
  frailties: MITM-able socket path, silent send-drops, orphan panes).
- [x] In-session recon (spawn gateway flaky — gateway listens on :18789 but
  spawn RPC times out; restarted once, still wedged; BLOCKER flagged):
  - `scout-chiaroscuro.md` — 5 engine contracts extracted; PUSH+RENDER
    BUILT TODAY (bridge/chiaroscuro.mjs 6/6 pins; live `g`/`G` modes in the
    tmux demo); PULL = next build (selection→VIEW under glyphs).
  - `scout-quilt-research-canons.md` — skill: WITNESS-DECLARES-SUCCESSOR +
    CORRECTIONS-IN-RECEIPTS.
  - `scout-qthe.md` — skill: PRICE-YOUR-CLAIMS + Layer 0/1/2 honesty split.
  - `scout-syzygy.md` — skill: MARK-YOUR-SHARDS (HEWN/SHAPED/DRAWN/SCARF) +
    SEED-NEVER-EDITED. SCARF adopted as the name for the exp029-vs-exp033/035
    tension face.
- Doctrine: *study how other builders think, name the pattern, teach it to
  every lane.* The differences between agents are the material.
- [ ] Standing lane: each scout report must land ≥1 quilt-skill into the
      shared skill pool with a receipt. (4 skills landed today.)
- [ ] BLOCKER: subagent spawn RPC (`ws://127.0.0.1:18789`) times out despite
      listener up; needs host-side diagnosis. Until then: main-session
      sequential recon (doctrine: sequential when needed, parallel down the road).

## Sequencing doctrine (sequential when needed, parallel down the road)
- One in-flight BUILD lane at a time (main session) + N scout lanes
  (subagents) + standing experiment lanes (cron/pulse).
- Roadmap docs are living: this file, `papers-recon.md`, `DESIGN.md`,
  each lane's PORTING/NOTES. Update on every receipt, not on request.

## Lane states (HEWN / SHAPED / DRAWN / SCARF — vocabulary from scout-syzygy)
- M1 fabric: **HEWN** (three ports pinned, live demo running)
- M2 editor adapter: **DRAWN** (tree-sitter imports→LINK spec'd in DESIGN §STATUS)
- M3 feed adapter: **SHAPED** (PUSH+RENDER hewn; PULL drawn; auth SCARF with claude-canvas's none)
- M4 experiment lanes: **HEWN** (exp034/035 sealed); exp036 **SPECCED** (dH/dt
  on MicroMoth-quilt PR history — law named from entropy-conservation,
  M6; awaiting Casey's merge gate like everything else)
- M5 ethnography: **HEWN** (4 skills landed); spawn gateway **SCARF** (restarted once,
  both-sides: listener healthy vs RPC wedged — needs host eyes)
- exp029-vs-exp033/035: **SCARF** — name the joint: pooled-REFUTED vs pair-RETAINED
  are both true at their resolutions; the reconciliation is resolution-dependent
  hazard, not contradiction. Casey reads the face.

## NEXT-BUILD SPEC (witness-declares-successor, from scout-quilt-research-canons)
Next artifact in this chain: **PULL interaction for the chiaroscuro projection.**
Build: in canvas.mjs glyph/sculpt mode, cursor selection maps to the substrate
cell under the glyph; `v` emits VIEW with that cell id and renders the returned
receipt digest in the status line. Pin: extend test_bridge.mjs with a
headless script `g,v,q` asserting the controller receives VIEW with the correct
cell while in glyph mode. Budget: one session. Then declare the successor:
the editor adapter (M2) as a fabric feeder, priced per scout-qthe (claims
layered 0/1/2, settling procedure attached).

## Hard rules (from the surveys, adopted as doctrine)
1. Gates are external — a lane never relaxes its own (self-edit-gate survey).
2. Every claim carries a receipt (digest/commit) or is labeled speculation.
3. SKIP > vacuous pass. FAIL-closed on unknown opcodes.
4. Push discipline: local work never blocks on push; branches accumulate
   with receipts until creds return.
