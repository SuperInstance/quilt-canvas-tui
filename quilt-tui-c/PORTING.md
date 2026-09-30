# PORTING.md — what the C port carries, and what it honestly doesn't

## The two cell models in this org (do not conflate)

| | `cell_api.py` (A2A surface) | `cell.h` (C99 polyformalism) |
|---|---|---|
| cell | addr + **8-dial array** + neighbors | id + **one scalar** `quilt_value_t` + reads + eval fn |
| EFFECT | dial[0] propagates to neighbors | evaluate the cell's formula against its reads |
| TICK | dials ±1, saturate at 0 | re-evaluate formula cells, tick++ |
| formula | kind string ("sum"/"product"/"max"/"min") | **function pointer** (`quilt_evaluator_t`) |
| graph digest | sha256 of `addr|kind|dials|neighbors|vN` | not in kernel — this port uses fnv1a64 over the **journal bytes** |

The Python and Node spreadsheet ports speak the dial-array model (byte-matched
to each other: same graph digest on the fixed 6-op script).
The C port speaks the **kernel's scalar model** — the more literal expression
of "a struct with a function pointer." It cannot and does not byte-match
`cell_api.py`'s graph digest; different state model.

## What IS pinned across all three

1. **FNV-1a 64** — identical implementation, classic test vector
   (`fnv1a64("a") == 0xaf63dc4c8601ec8c`) in all three ports.
2. **Opcode semantics through the real kernel** — the C port calls
   `quilt_bind/link/effect/view/tick/forget` directly; Python/Node reimplement
   the dial-array laws and byte-match each other.
3. **Journal byte format** (C lane): `test_bytematch` compares the kernel's
   journal bytes entry-for-entry against `gen_expected_journal.py`, an
   independent transcription of the format in `src/engine.c` journal_append:
   `[op:1][id_len:2 LE][id][arg:8 LE]` with BIND-create arg=1, BIND-update
   arg=version, LINK arg=to-index, EFFECT arg=version, TICK arg=tick,
   FORGET arg=0.
4. **The laws** — bind idempotent, VIEW pure, TICK monotonic, FORGET complete,
   LINK cycle-rejected (DAG) — asserted in every port's test suite.

## Gotcha worth teaching: borrowed cell ids

`quilt_cell_t.id` is a **borrowed pointer** (cell.h: "borrowed; the cell's
stable identity"). The first driver version passed a stack buffer reused per
line — engine cells silently aliased the newest string (BIND B1 overwrote
A1's identity). Fixed by copying ids into fabric-owned `id_ring` storage at
creation and repointing. Any future port: OWN YOUR ID BYTES.

## Keys

arrows/hjkl move · `e` value · `f` formula (`sum A1,B2`) · `L` link
(ENTER src, ENTER dst) · `x` effect · `v` view · `t` tick · `d` forget ·
`q` quit. `QUILT_HEADLESS=1` → line-based stdin (test hook).

## Build & test

```
make            # driver, tui, test_bytematch
make test       # 10 pins incl. the python-reference journal byte-match
make smoke      # 6-op JSON-lines driver run
```
