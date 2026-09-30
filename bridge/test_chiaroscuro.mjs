// FAIL-first pins for bridge/chiaroscuro.mjs — the L4 feed renderer.
// Model: chiaroscuro engines are per-cell decision procedures over a
// substrate. Our substrate = the quilt fabric. Each fabric cell contributes
// a normalized "tone" (0..1) and optionally an "edge" magnitude+direction.
// Engine contracts follow SuperInstance/chiaroscuro README §6:
//   glyph:  brightness → 70-step Fine ramp (we use the classic 10-step
//           for terminal fidelity, Fine is browser-only by design)
//   sculpt: brightness + edge magnitude → box-drawing slope glyphs
// Receipt discipline: deterministic, no deps, no timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const RAMP10 = " .:-=+*#%@";

test("ramp: 0 → lightest glyph, 1 → darkest, monotone non-decreasing", async () => {
  const { ramp } = await importFresh();
  assert.equal(ramp(0, RAMP10), " ");
  assert.equal(ramp(1, RAMP10), "@");
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const idx = RAMP10.indexOf(ramp(i / 20, RAMP10));
    assert.ok(idx >= prev, `monotone at i=${i}`);
    prev = idx;
  }
});

test("ramp: clamps out-of-range and empty ramp fails closed", async () => {
  const { ramp } = await importFresh();
  assert.equal(ramp(-5, RAMP10), " ");
  assert.equal(ramp(99, RAMP10), "@");
  assert.equal(ramp(0.5, ""), "�"); // fail-closed glyph, not a throw
});

test("renderGrid: tone from dials — cell heat = max dial normalized", async () => {
  const { renderGrid } = await importFresh();
  // fabric: 2x2. A1 dials [8,0] → heat 8/255; B1 empty → heat 0; etc.
  const fabric = {
    tick: 1,
    cells: [
      { id: "A1", version: 2, dials: [8, 0],   formula: null, kind: "generic", reads: [], links: [] },
      { id: "B1", version: 1, dials: [255, 0], formula: null, kind: "generic", reads: [], links: [] },
      { id: "A2", version: 1, dials: [],       formula: null, kind: "generic", reads: [], links: [] },
      { id: "B2", version: 3, dials: [128],    formula: null, kind: "generic", reads: [], links: [] },
    ],
    links: [],
  };
  const grid = renderGrid(fabric, { cols: 2, rows: 2, engine: "glyph", dialCap: 255 });
  const lines = grid.split("\n");
  assert.equal(lines.length, 2);
  // B1 (255) must be strictly darker than A1 (8)
  const dark = (ch) => RAMP10.indexOf(ch);
  assert.ok(dark(lines[0][1]) > dark(lines[0][0]));
  // A2 empty → lightest
  assert.equal(lines[1][0], " ");
  // B2 (128) mid-tone, darker than A1(8)? 128/255≈0.5 → idx 5; 8/255→idx 0
  assert.ok(dark(lines[1][1]) > dark(lines[0][0]));
});

test("renderGrid: sculpt engine — linked cells render as edges (─/│/┌), magnitude from link count", async () => {
  const { renderGrid } = await importFresh();
  const fabric = {
    tick: 1,
    cells: [
      { id: "A1", version: 2, dials: [100], formula: null, kind: "generic", reads: [], links: ["B1", "A2"] },
      { id: "B1", version: 1, dials: [100], formula: null, kind: "generic", reads: [], links: ["A1"] },
      { id: "A2", version: 1, dials: [100], formula: null, kind: "generic", reads: [], links: ["A1"] },
      { id: "B2", version: 1, dials: [100], formula: null, kind: "generic", reads: [], links: [] },
    ],
    links: [["A1", "B1"], ["A1", "A2"]],
  };
  const grid = renderGrid(fabric, { cols: 2, rows: 2, engine: "sculpt", dialCap: 255 });
  const EDGE = new Set("─│┌┐└┴┬├┤╋╱╲═║╔╗╚╠╦╬");
  // A1 has 2 links (high magnitude) → edge glyph; B2 has none → tone glyph
  assert.ok(EDGE.has(grid.split("\n")[0][0]), "A1 should render as edge");
  assert.ok(!EDGE.has(grid.split("\n")[1][1]), "B2 should render as tone");
});

test("renderGrid: unknown engine fails closed with error row, not a throw", async () => {
  const { renderGrid } = await importFresh();
  const grid = renderGrid({ tick: 0, cells: [], links: [] }, { cols: 2, rows: 1, engine: "nonsense" });
  assert.match(grid, /ERR/);
});

test("renderGrid: determinism — same fabric, same bytes", async () => {
  const { renderGrid } = await importFresh();
  const fabric = {
    tick: 7,
    cells: [
      { id: "A1", version: 9, dials: [1, 2, 3], formula: "sum A1,B1", kind: "sum", reads: ["A1", "B1"], links: ["B1"] },
      { id: "B1", version: 1, dials: [4], formula: null, kind: "generic", reads: [], links: ["A1"] },
    ],
    links: [["A1", "B1"]],
  };
  const a = renderGrid(fabric, { cols: 2, rows: 1, engine: "sculpt" });
  const b = renderGrid(fabric, { cols: 2, rows: 1, engine: "sculpt" });
  assert.equal(a, b);
});

async function importFresh() {
  // isolate module state per test file run
  const require = createRequire(import.meta.url);
  const mod = "./chiaroscuro.mjs";
  const resolved = require.resolve(mod);
  const q = `?t=${Date.now()}-${Math.random()}`;
  return await import(resolved + q);
}
