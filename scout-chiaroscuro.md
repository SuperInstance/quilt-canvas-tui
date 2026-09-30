# scout-chiaroscuro.md — bidirectional extension recon (main-session; Scout G spawn failed ×3 on gateway timeout, recon done in-session from the full README)

Source: https://github.com/SuperInstance/chiaroscuro (README, complete fetch 2026-09-30).

## What exists (verified from README)

- **5 engines as per-cell decision procedures** over a downsampled substrate:
  glyph (brightness→ramp), sculpt (brightness+Sobel angle/magnitude→box-drawing),
  pixel (half-block `▀` 2-color), braille (2×4 dot bitmap, U+2800+bitmask),
  shape-match (4×6 glyph-bitmap Hamming election), halftone (fill-ratio dots).
- **Input contract per cell**: luma (0.299/0.587/0.114 weights), Sobel (gx,gy),
  variance, RGB. Five values, one pass. → maps directly onto quilt cell dials.
- **Exports freeze the decision procedure 3 ways**: self-contained HTML
  (fetch own source + inject bootState + hide panel), Python/OpenCV terminal
  app (ANSI 24-bit), flat JSON. Plus share-URL. "What you tuned wasn't a
  filter preset; it was the decision procedure."
- **?mock=1 determinism** for machine playtesting (Playwright harnesses in tools/).
- **The Director**: aesthetic engine that reads scene stats, composes, NAMES
  the composition ("Feral Silhouette") — "the name is the receipt."
- Honest ledger culture: failures first-class ("The Fine ramp is 70 levels
  nobody can name", "Slow Neon Rain rendered zero photons — the fix is a
  clamp, not a taste").
- Reader's Fold: fleet-wide content-addressed pointer convention
  (quilt-links.mjs); Law 6 quoted: "Receipts in, questions out."

## The gap for BIDIRECTIONAL (what quilt-canvas adds)

| direction | what exists | what's missing | smallest build |
|---|---|---|---|
| PUSH (feed→substrate) | camera only; no arbitrary feed input | a feed→dial adapter: any byte stream (agent logs, receipts, CI) normalized into cell dials | **DONE today in bridge/chiaroscuro.mjs** — fabric cells are the substrate; dials→tone, links→edge. 6/6 pins. |
| RENDER | browser canvases + python terminal app | TUI-native glyph/sculpt over a quilt fabric | **DONE today** — `g`/`G` toggles in canvas.mjs; live in tmux demo (glyph `%.'` for dial 250/40; sculpt `──` on linked pair). |
| PULL (view→receipt) | none — chiaroscuro is one-way, stateless, no hit-testing; Viewfinder captures but doesn't link back | click/selection on a rendered glyph → cell address → VIEW opcode → receipt | **NEXT BUILD**: canvas selection already tracks cursor cell; in glyph mode, selection IS the cell under the glyph. Wire `v` to emit VIEW with the substrate cell id. One evening. |
| PROCEDURE PORTABILITY | export-as-HTML/JSON freezes looks | freeze a *workflow projection* (fabric+engine state) the same way | export fabric JSON + engine name as a bootState block; gh-pages Lane C already replays fabric opcodes — add `?engine=sculpt` boot param. |

## Adopted contracts (already implemented in bridge/chiaroscuro.mjs)

- tone = max|dial| / dialCap, monotone ramp, 1970s RAMP10 for terminal fidelity
  (README's Fine ramp is browser-only by design — documented, not a drift).
- sculpt edge override when link magnitude ≥ threshold (README's edgeMix
  semantics); heavy variant at mag ≥ 2 (EDGE_HEAVY).
- fail-closed: unknown engine renders `ERR:<name>` row, never throws; empty
  ramp → `�`. (README's "clamp, not a taste" — same law.)
- determinism: same fabric → same bytes (pinned by test).

## Drift risks to watch

1. Our sculpt "direction" is grid-topology (row/col of link targets), NOT
   Sobel angle on an image. Documented as a stand-in, not claimed as Sobel.
2. chiaroscuro engines are stateless per frame; our fabric has versions —
   a "trails" dial would need tick-history. Not built; ledger item.
3. Pixel/braille/shape-match engines not ported to TUI (shape-match cost:
   70 Hamming elections/cell — the README's own "slow lane"). Queue behind
   pull-interaction.
