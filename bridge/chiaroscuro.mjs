// bridge/chiaroscuro.mjs — L4 feed renderer for quilt-canvas.
// Port of SuperInstance/chiaroscuro's engine contracts (README §6) onto the
// quilt fabric as substrate. Per-cell decision procedure, deterministic,
// zero deps. A rendered frame is a receipt of the fabric state.
//
// Engine input contracts (from the chiaroscuro README):
//   glyph  — brightness (one value per cell) → tone ramp
//   sculpt — brightness + edge magnitude → box-drawing slope glyphs
// The fabric provides: dials (→ tone), links (→ edge structure).

export const RAMP10 = " .:-=+*#%@"; // 1970s teletype ramp, the README's historical default
export const EDGE_LIGHT = ["─", "╱", "│", "╲"]; // 4 cardinal slopes by angle quadrant
export const EDGE_HEAVY = ["═", "╱", "║", "╲"]; // high-magnitude variants

// ramp(v, rampStr): normalized 0..1 → glyph. Fail-closed: empty ramp → "�",
// out-of-range clamps. Never throws on bad input (canvas keeps rendering).
export function ramp(v, rampStr = RAMP10) {
  if (!rampStr || rampStr.length === 0) return "�";
  if (!(v > 0)) return rampStr[0]; // covers NaN, negatives
  if (v >= 1) return rampStr[rampStr.length - 1];
  return rampStr[Math.floor(v * (rampStr.length - 1))];
}

// cellTone(cell, dialCap): normalized brightness from a fabric cell's dials.
// Empty dials → 0 (blank paper). Deterministic.
export function cellTone(cell, dialCap = 255) {
  const d = cell?.dials;
  if (!Array.isArray(d) || d.length === 0) return 0;
  let m = 0;
  for (const x of d) { const v = Math.abs(x); if (v > m) m = v; }
  return Math.min(1, m / dialCap);
}

// cellEdge(cell): magnitude (0..) and a direction index 0..3 from link
// geometry. Direction: count links going to column-neighbors as horizontal,
// row-neighbors as vertical; the dominant axis picks the glyph family.
// This is a cheap stand-in for Sobel on a grid — documented, not claimed
// to be image Sobel.
export function cellEdge(cell, allCells = []) {
  const links = Array.isArray(cell?.links) ? cell.links : [];
  const mag = links.length;
  if (mag === 0) return { mag: 0, dir: 0 };
  const byId = new Map(allCells.map((c) => [c.id, c]));
  let horiz = 0, vert = 0;
  for (const id of links) {
    const t = byId.get(id);
    if (!t) continue;
    const [fc, fr] = splitId(cell.id);
    const [tc, tr] = splitId(t.id);
    if (tc !== fc) horiz++;
    if (tr !== fr) vert++;
  }
  // dir: 0 = horizontal face, 2 = vertical wall; diagonal when tied & both present
  if (horiz > 0 && vert > 0) return { mag, dir: horiz >= vert ? 0 : 2 };
  if (horiz > 0) return { mag, dir: 0 };
  return { mag, dir: 2 };
}

function splitId(id) {
  const m = /^([A-Z]+)([0-9]+)$/.exec(String(id ?? ""));
  if (!m) return [0, 0];
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [col, parseInt(m[2], 10)];
}

// renderGrid(fabric, opts): fabric {tick, cells, links} → text grid.
// opts: {cols, rows, engine: "glyph"|"sculpt", dialCap}
// FAIL-closed on unknown engine: first row is "ERR:<engine>" and the rest
// is blank — the renderer reports, never crashes (canvas stays alive).
export function renderGrid(fabric, opts = {}) {
  const cols = opts.cols ?? 8;
  const rows = opts.rows ?? 4;
  const engine = opts.engine ?? "glyph";
  const cap = opts.dialCap ?? 255;
  if (engine !== "glyph" && engine !== "sculpt") {
    // Never truncate the error prefix — a fail-closed row must stay
    // readable at any grid width (the row may exceed cols by design).
    const blank = " ".repeat(cols);
    return [`ERR:${engine}`.padEnd(cols, " "), ...Array(rows - 1).fill(blank)].join("\n");
  }
  const cells = Array.isArray(fabric?.cells) ? fabric.cells : [];
  const grid = [];
  for (let r = 1; r <= rows; r++) {
    let line = "";
    for (let c = 1; c <= cols; c++) {
      const id = colName(c) + r;
      const cell = cells.find((x) => x.id === id);
      const tone = cellTone(cell, cap);
      if (engine === "glyph") {
        line += ramp(tone, opts.ramp ?? RAMP10);
      } else {
        // sculpt: edge overrides tone when magnitude ≥ threshold (README:
        // edgeMix — "how much of the edge glyph should override the tone")
        const edge = cellEdge(cell, cells);
        const thresh = opts.edgeThreshold ?? 1;
        if (edge.mag >= thresh) {
          const heavy = edge.mag >= (opts.heavyAt ?? 2);
          const set = heavy ? EDGE_HEAVY : EDGE_LIGHT;
          line += set[edge.dir] ?? set[0];
        } else {
          line += ramp(tone, opts.ramp ?? RAMP10);
        }
      }
    }
    grid.push(line);
  }
  return grid.join("\n");
}

function colName(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s || "A";
}
