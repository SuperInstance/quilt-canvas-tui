# PORTING.md — the fabric as a portable record

*The state is not trapped in the process. The state is a file that walks.*

## The record (`quilt-record/v1`)

One fabric, one portable unit. `op.mjs save` writes it; the web "port" button downloads
it; the builder can write one itself (`{"op":"save","tier":"gist"}` — SAVE is whitelisted,
FORGET never is). Shape:

```json
{
  "schema": "quilt-record/v1",
  "generated_at": "<ISO>", "tier": "full|gist|hint",
  "fabric": { "cells": [{"addr","kind","dials":[]}], "links": [["A","B"]] },
  "ledger": { "len": N, "tip": "<hex>" },
  "log":    { "questions": [{"ts","q","from"}], "answers": [{"ts","qts","from","reply","ops_applied",...}] },
  "notes":  { "readme": "<agent-POV markdown>" }
}
```

## Levels of complexity (tiers)

- **full** — lossless JSON + `README.md` + `csv/` (`cells.csv`, `links.csv`, `thread.csv`).
  The CSVs open in any spreadsheet: the sheet view *is* the export.
- **gist** — ledger tip + last 20 thread entries + README. Enough to resume a conversation
  about the fabric without hauling its whole history.
- **hint** — README + ledger tip only. What survives when the transport can't hold more.
  A generic format degrades to the hint tier and is still a bootstrappable record.

**Essential components** — a file without `cells(addr,kind,dials)` + `links` + ledger tip
is not a quilt record. Everything else degrades gracefully; these three never do.

## Dual collection (both sides of the rack)

Every record carries **ActiveLog** (the thread: questions, replies, forks — the front of
the rack) and **ActiveLedger** (cells, links, ledger tip — the back). One keystroke flips
the rack; a port ships both sides. A frontend-only export loses the reasoning; a
backend-only export loses the conversation that explains it.

## Porting translation layer — "everything since the last read by my engine"

Each engine holds a **cursor** (`/tmp/quilt-canvas/cursors/<engine>.json`, ledger len + ts).
`op.mjs since <engine>` returns the delta since THAT engine's last read — new thread
entries, fabric at tip — then advances the cursor. Two engines sync by trading deltas,
not whole states. (Receipt-body streaming from the controller is the follow-up; today the
ledger surface carries `ok/len/tip` and the log is delta-faithful.)

## Convergent load — records never delete

`op.mjs load <record> --dry-run` diffs record vs live: what would rebind, what conflicts,
what links are missing. `--apply` converges the live fabric **toward** the record with
rebind-in-place only. Nothing is ever removed — FORGET does not exist, one forget seals an
unverifiable receipt and bricks the ledger. Loading a gist or hint into a live fabric is a
merge, not a restore.

## The README is the record's voice (zeroshot POV, first-class)

Every tier carries `notes.readme` written from the reader's viewpoint: what is built here,
what is honest placeholder, what I was asked and said, which forks are open, how to
re-bootstrap me. The hint tier is *just* this — and that's deliberate: the
lowest-common-denominator format is the strongest port, because any agent (or human) can
pick it up cold. This scales down to folders: a directory's README.md written in the
agent's POV is the same doctrine at repo scale — components keep their own self-describing
records, and **agents keep their tools** (a tool an agent built to do its task is an
artifact, not scratch paper).

## Git-agents per component

`records/` is git-tracked: every saved record can be committed, and the commit log is the
component's autobiography. The same pattern runs at every scale — repo README as the
zeroshot entry, records/ as fabric checkpoints, per-component folders carrying their own
POV readmes. Each is a git-agent's "everything since last read," written down.

## Spawn-through-routes

`op.mjs brief` prints the tunnel a fresh agent walks: identity → this fabric's record →
how to act → the CLI → the builder contract → the live surfaces → this file. Spawning an
agent means handing it these **routes** — organic bootstrapping through existing records
and tools — never a blank slate and never a duplicated context dump.
