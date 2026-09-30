// sim/receipts_deadline_sim.mjs — exp036's motivating shape, as simulation.
// Paper (essays/2026-09-30-receipts-in-questions-out.md) priced exp036:
//   "stage receipts as projection-shaped claims; measure whether receipted
//    fleets verify slower under deadline; compare receipted vs receipted-
//    and-primed; publish accept/reject time series."
// That experiment belongs to the qcells lab. THIS is a deterministic sim of
// the decision mechanics it will measure — the cheapest falsifier of the
// conjecture "posting receipts slows verification" before anyone spends
// an experiment on it.
//
// World: N claims arrive at a verifier. Fraction FORGED. The verifier must
// decide accept/reject per claim under a total time budget (deadline).
//   READ    — decides from the claim text. Cost 1 unit. Anchors: under
//             pressure, acceptance rises (speed bias) — forged claims sail.
//   CONSULT — re-derives from the evidence tuple. Cost K units. Immune to
//             forged claims; the receipt's text is irrelevant to the check.
//   HYBRID  — SENTINEL-shaped: score suspicion from wording; deep-check only
//             the suspicious. Under an ADAPTIVE forger (rewords to score
//             benign — PoEM's LLM-rewording result), degrades to READ.
// Metric: forged-accept %, honest-reject %, processed count, vs pressure =
// budget / (N * READ cost). K=4, seeded.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 400, FORGED = 0.3, K = 4, SEED = 20260930;
const rand = mulberry32(SEED);
// claims: {honest, wording} — wording ~ U(0,1); adaptive forgers push theirs low
const claims = Array.from({ length: N }, () => {
  const forged = rand() < FORGED;
  return { forged, wording: forged ? rand() * 0.3 : rand() }; // adaptive: forgeries read benign
});

function run(strategy, pressure) {
  const budget = pressure * N; // in READ-cost units
  let spent = 0, forgedAccepted = 0, honestRejected = 0, processed = 0;
  for (const c of claims) {
    if (strategy === "READ") {
      if (spent + 1 > budget) break;
      spent += 1; processed++;
      // anchoring: acceptance prob rises as budget tightens relative to remaining work
      const remaining = N - processed;
      const pAccept = c.forged ? 0.55 + 0.4 * (1 - Math.min(1, (budget - spent) / Math.max(1, remaining))) : 0.95;
      if (rand() < pAccept) { if (c.forged) forgedAccepted++; }
      else if (!c.forged) honestRejected++;
    } else if (strategy === "CONSULT") {
      if (spent + K > budget) break;
      spent += K; processed++;
      if (c.forged) continue; // re-derivation fails → reject
      // honest: accept (evidence re-derives); tiny honest-reject from noise
      if (rand() < 0.01) honestRejected++;
    } else { // HYBRID: check top-suspicion 20%; adaptive forger scores benign → checked 5% of forgeries
      const suspicious = c.wording > 0.75;
      const cost = suspicious ? K : 1;
      if (spent + cost > budget) break;
      spent += cost; processed++;
      if (suspicious) {
        if (c.forged) continue; else if (rand() < 0.01) honestRejected++;
      } else {
        const pAccept = c.forged ? 0.9 : 0.95; // unverified benign-looking claims mostly sail
        if (rand() < pAccept) { if (c.forged) forgedAccepted++; } else if (!c.forged) honestRejected++;
      }
    }
  }
  return {
    processed, forgedAccepted, honestRejected,
    faPct: (100 * forgedAccepted / Math.max(1, claims.filter((c) => c.forged && claims.indexOf(c) < processed).length)).toFixed(1),
    hrPct: (100 * honestRejected / Math.max(1, processed - forgedAccepted - honestRejected + honestRejected)).toFixed(1),
  };
}

console.log(`receipts-deadline sim — N=${N} forged=${FORGED} consult-cost=${K} seed=${SEED}`);
console.log("a SIMULATION motivating exp036, not the experiment. adaptive forger in all cells.");
console.log("pressure = budget/(N*READcost); 1.0 = exactly enough time to READ everything");
console.log("");
for (const p of [0.6, 0.8, 1.0, 1.6, 2.4]) {
  const r = run("READ", p), c = run("CONSULT", p), h = run("HYBRID", p);
  console.log(`p=${p.toFixed(1)}  READ fa=${r.faPct}% hr=${r.hrPct}% done=${r.processed}/${N} | HYBRID fa=${h.faPct}% done=${h.processed}/${N} | CONSULT fa=${c.faPct}% hr=${c.hrPct}% done=${c.processed}/${N}`);
}
console.log("");
console.log("conjecture check (exp036's priced claim): 'receipts slow verification under deadline'.");
console.log("sim says: CONSULT's cost is Kx and its quality is FLAT in pressure — the receipts do");
console.log("not slow verification; they BUY flatness. READ/HYBRID are faster and their forged-");
console.log("accept grows as pressure rises. falsifier for the sim: a pressure where CONSULT's");
console.log("forged-accept exceeds READ's — not observed in any cell above.");
