---
name: quilt-canvas-tui
description: Drive a claude-canvas-style TUI whose second panel is a quilt — controller+canvas over a unix socket, fabric ports Python/Node/C99 byte-identical. Use when an agent or user needs a live fabric view inside tmux.
---

# quilt-canvas-tui — the fabric gets a face

Terminal-native sibling of quilt-canvas (web/WASM): a two-pane TUI where the
second panel is a QUILT — every cell an addressable capability, the channel
running both directions. All surfaces FAIL-first pinned.

## Run it

```sh
cd bridge
node test_bridge.mjs          # 10/10 — controller/canvas socket protocol
node test_chiaroscuro.mjs     # 6/6  — projection modes
QUILT_SOCK=/tmp/demo.sock node canvas.mjs   # needs a controller; else offline mode
node fleet_board.mjs          # dogfood controller: fleet lanes as cells w/ real receipt dials
```

## The seam (this is the part agents care about)

- **Controller + canvas over a unix socket**, NDJSON, claude-canvas
  protocol-shape EXTENDED with fabric opcodes. Anything that can write NDJSON
  to a socket can drive the canvas — including an agent.
- **Three fabric ports, byte-identical digests** on a fixed six-op script:
  Python (`quilt-tui-py/`), Node (`bridge/`), C99 (`quilt-tui-c/` over the
  real quilt-c kernel). 16/16 tests.
- **Chiaroscuro**: `g` glyph mode (dials→tone ramp), `G` sculpt mode
  (links→edges) — same fabric, many renderings, one genome underneath.

## Gotchas (each one bit someone)

- **`QUILT_SOCK` env var ONLY** — `node canvas.mjs /tmp/demo.sock` silently
  ran offline; argv is ignored. The footer says `offline` when no controller
  is reachable: believe it.
- **Genome ≠ evidence**: `cellDigest` (dials+links) is the genome; journal
  receipts testify. A projection renders the genome and cannot flatter you —
  never edit a projection to look better; change the fabric.
- FAIL-first law: every pin observed RED before the implementation that makes
  it pass. SKIP, never vacuous pass.
- Lanes carry marks (HEWN/SHAPED/DRAWN/SCARF); ROADMAP ends with a
  witness-declared successor spec. Read ROADMAP.md before building.

## Integration surface (open-terminal pivot, 2026-10-02)

Designed to run as a tmux-hosted panel beside an intelligent-terminal, or
toggled inside it — operated by a user OR an agent driving an application
through the terminal. The socket protocol is the integration seam.

## Neighbors

quilt-c (kernel) · quilt-tui (browser sibling) · superinstance-api
(intents-as-cells) · exoj (field→projection adapter) · quilt-canvas (web/WASM
line).
