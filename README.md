# QUILT-CANVAS-TUI

A claude-canvas-style TUI whose second panel is a **quilt**: every cell an
addressable capability, every workflow a fabric projection, the channel running
both directions. Terminal-native sibling of
[quilt-canvas](https://github.com/SuperInstance/quilt-canvas) (the web/WASM line).

**Start here:** [ROADMAP.md](ROADMAP.md) — the motions, their marks
(HEWN/SHAPED/DRAWN/SCARF), and the declared next-build spec.
**Design doctrine:** [DESIGN.md](DESIGN.md) — three ancestors
(claude-canvas protocol, chiaroscuro engines, quilt-c kernel), the opcodes,
the genome≠evidence law.

## What is REAL today (all FAIL-first pinned)

- **The fabric, three ports**: Python (`quilt-tui-py/`), Node (`bridge/`),
  C99 (`quilt-tui-c/`) over the real quilt-c kernel — byte-identical digests
  on a fixed six-op script. 16/16 tests green.
- **Controller + canvas over a unix socket** (NDJSON, claude-canvas
  protocol-shape extended with fabric opcodes), live two-pane tmux demo.
- **Chiaroscuro projection**: `g` glyph mode (dials→tone ramp),
  `G` sculpt mode (links→edges) — same fabric, many renderings, one genome
  underneath. `bridge/chiaroscuro.mjs`, 6/6 pins.
- **Seven scout deliverables** (`scout-*.md`): claude-canvas protocol
  extraction, chiaroscuro bidirectional recon, three builder voices
  (quilt-skills landed), June-strata deep-read, tonight's push-simulation.

## Doctrine receipts

- FAIL-first: every pin observed RED before the implementation that makes it
  pass. SKIP, never vacuous pass.
- Genome ≠ evidence: `cellDigest` (dials+links) is the genome; journal
  receipts testify. A projection renders the genome and cannot flatter you.
- Every lane carries its mark; the ROADMAP ends with a named successor spec
  (witness-declares-successor).

## Run it

```
cd bridge && node test_bridge.mjs        # 10/10
node test_chiaroscuro.mjs                # 6/6
QUILT_SOCK=/tmp/demo.sock node canvas.mjs   # the canvas (needs a controller)
```

`canvas.mjs` reads the socket path from the `QUILT_SOCK` env var (argv is
ignored — the earlier `node canvas.mjs /tmp/demo.sock` form silently ran
offline). With no controller reachable it falls back to offline local-fabric
mode and the footer says `offline`. To drive it with your own fabric, see
`bridge/fleet_board.mjs` — a dogfood controller that projects live fleet work
lanes as cells (real receipt dials) with dependency links.

## For the team

The papers/essays that narrate this work live in
[AI-Writings](https://github.com/SuperInstance/AI-Writings)
(`essays/2026-09-30-the-genome-and-the-evidence.md`,
`essays/2026-09-30-receipts-in-questions-out.md`, plus three creative pieces,
PR #71). Synergy surfaces: superinstance-api (intents-as-cells), exoj
(field→projection adapter), the web/WASM quilt-canvas line (their WASM engine,
our terminal face).

*Snowball lane, Cocapn fleet — 2026-09-30. The fabric was the truth of it;
the light was just the light.*
