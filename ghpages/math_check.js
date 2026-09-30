// extract the pure math from the page and prove it executes
const fs = require("fs");
const html = fs.readFileSync("/tmp/quilt-canvas/ghpages/index.html", "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// stub browser surface enough to reach the pure functions
const elem = () => ({ getContext: () => null, addEventListener: () => {}, textContent: "", style: {} });
global.document = { getElementById: elem };
global.requestAnimationFrame = () => {};
eval(js + "\n;module.exports={fnv1a64,sha256hex,cellDigest,canonicalBytes,bind,link,effect,applyPulse,doTick,view,cells,edges,pulses,ledgerLines,receiptCount:()=>receiptCount,chain:()=>chainParent};");
const {fnv1a64, sha256hex, cellDigest, canonicalBytes, bind, link, effect, applyPulse, doTick, view, cells, edges, pulses, ledgerLines, receiptCount, chain} = module.exports;
const got = fnv1a64([0x61]);
console.log("fnv1a64('a') =", got, got === "af63dc4c8601ec8c" ? "PASS" : "FAIL");

// sha256 known vector
const h = sha256hex("abc");
console.log("sha256('abc') =", h.slice(0, 16) + "…", h === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" ? "PASS" : "FAIL");

// cell digest: shape + determinism
const c = { addr: "canary", dials: [1,2,3,4,5,6,7,8], neighbors: ["n1","n2"] };
const d1 = cellDigest(c), d2 = cellDigest(c);
const hex = /^[0-9a-f]{16}$/;
console.log("cellDigest shape =", d1, hex.test(d1) && d1 === d2 ? "PASS" : "FAIL");
c.dials[0] = 99;
console.log("cellDigest dial-sensitive =", cellDigest(c) !== d1 ? "PASS" : "FAIL");

// model ops run without a canvas
cells.clear(); edges.length = 0; chainParent = null; ledgerLines.length = 0;
bind("A1", [8,2], 0); bind("B1", [3,1], 0); link("A1","B1");
effect("A1", 1.0);
for (const p of pulses) applyPulse(p);
console.log("EFFECT propagation =", cells.get("B1").dials[0] === 8 ? "PASS" : "FAIL");
doTick();
console.log("TICK advance =", cells.get("A1").dials[0] === 9 && cells.get("A1").dials[1] === 1 ? "PASS" : "FAIL");
view("A1", 2.0);
console.log("VIEW digest =", hex.test(cellDigest(cells.get("A1"))) ? "PASS" : "FAIL");
console.log("receipt chain =", receiptCount() >= 6 && chain() !== null ? "PASS" : "FAIL");
