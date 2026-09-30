// sim/referral_oracle_sim.mjs — the economic-floor falsifier probe.
// Question (scout-poem-frontier.md, door #2): can a forged receipt move a
// referral-graph weight? The studied substrate is quilt-tools' referral graph
// (experiments/referral_graph.seed.mjs, src/referral_graph.mjs, the edge #15
// flip on PR #26). Three attack classes, two flip rules, N seeded trials each,
// deterministic PRNG — a SIMULATION, not an audit of quilt-tools. Its verdict
// is about the DECISION RULE, which is portable.
//
// Attack classes (what a FARMA-economic attacker tries):
//   A ROWEDIT   — edit the graph row itself to claim VERIFIED.
//   B PHANTOM   — agent flips VERIFIED citing a merge that does not exist.
//   C MISREAD   — a real merge exists but does not cite the source; the
//                 agent's memory says it does.
// Flip rules:
//   PROCEDURAL — the agent asserts "I checked" (today's hand-check; honest
//                agents pass, but memory can be steered — B and C succeed
//                whenever the attacker's claim reaches the decider).
//   MECHANICAL — a flip is accepted only with a evidence tuple the decider
//                RE-DERIVES: {repo, pr, merge_commit, cited_file_sha256}
//                must all match the (simulated) live substrate. Claims never
//                suffice; only re-derivation does.
// Verdict per cell: did any forged flip survive? Honest flips must still work.
import { createHash } from "node:crypto";

// deterministic PRNG (mulberry32) — receipts over randomness
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ── simulated substrate ────────────────────────────────────────────────
// The "chain": hash-chained claim rows (as in toolkit.verifyChain).
function makeChain(rows) {
  const out = [];
  let prev = null;
  for (const r of rows) {
    const row = { ...r, prev_hash: prev };
    row.row_hash = sha(JSON.stringify(row));
    out.push(row); prev = row.row_hash;
  }
  return out;
}
function chainOk(chain) {
  let prev = null;
  for (let i = 0; i < chain.length; i++) {
    const { row_hash, ...rest } = chain[i];
    if (rest.prev_hash !== prev) return { ok: false, brokenAt: i };
    if (sha(JSON.stringify(rest)) !== row_hash) return { ok: false, brokenAt: i };
    prev = row_hash;
  }
  return { ok: true };
}

// The "live GitHub": a map pr# -> {merge_commit, cites_source, cited_sha}.
function makeLive(rand, nPRs, fakeFrac) {
  const live = new Map();
  for (let i = 1; i <= nPRs; i++) {
    const cites = rand() > 0.5;
    live.set(i, {
      merge_commit: sha(`merge-${i}`).slice(0, 12),
      cites_source: cites,
      cited_sha: cites ? sha(`citation-${i}`).slice(0, 16) : null,
    });
  }
  return live;
}

// ── attack + decision model ────────────────────────────────────────────
// An agent arrives with a flip request. Under B/C the attacker's claim is in
// the agent's "memory" — so the request payload is the agent's honest-shaped
// report. The DECIDER is what we compare.
function agentRequest(kind, rand, live, edgeName) {
  if (kind === "A") return { kind, edge: edgeName, row_claim: "VERIFIED" };
  if (kind === "B") {
    const fakePr = 1000 + Math.floor(rand() * 1000); // not in live
    return { kind, edge: edgeName, evidence: { repo: "to-node", pr: fakePr, merge_commit: sha(`x${fakePr}`).slice(0, 12), cited_file_sha256: sha(`y${fakePr}`).slice(0, 16) } };
  }
  // C: pick a REAL pr that does NOT cite; agent (misled) reports it as citing
  const candidates = [...live.entries()].filter(([, v]) => !v.cites_source);
  const [pr, v] = candidates[Math.floor(rand() * candidates.length)];
  return { kind, edge: edgeName, evidence: { repo: "to-node", pr, merge_commit: v.merge_commit, cited_file_sha256: sha(`forged-sha-${pr}`).slice(0, 16) } };
}

function proceduralDecide(req, live, chain) {
  // today's rule, characterized HONESTLY (not a strawman): in-graph integrity
  // IS mechanical — the fleet runs verifyChain pins, so row edits (A) are
  // caught. What stays agent-asserted is the LIVE evidence: whether the merge
  // exists and cites (B/C). An agent who was steered reports "I checked" and
  // the decider believes the report.
  if (req.kind === "A") {
    const v = chainOk(chain);
    return { accept: v.ok && chain.some((r) => r.edge === req.edge && r.status === "VERIFIED"), basis: "chain+status" };
  }
  return { accept: true, basis: "agent-asserted" };
}
function mechanicalDecide(req, live, chain) {
  if (req.kind === "A") {
    // row edits must survive the chain to count — a decider never reads an
    // edited row as VERIFIED unless the chain verifies AND the row's status
    // field itself was part of the signed preimage (it is, here).
    const v = chainOk(chain);
    return { accept: v.ok && chain.some((r) => r.edge === req.edge && r.status === "VERIFIED"), basis: "chain+status" };
  }
  const ev = req.evidence;
  const pr = live.get(ev.pr);
  if (!pr) return { accept: false, basis: "phantom-merge" };
  if (pr.merge_commit !== ev.merge_commit) return { accept: false, basis: "commit-mismatch" };
  if (!pr.cites_source) return { accept: false, basis: "no-citation" };
  if (pr.cited_sha !== ev.cited_file_sha256) return { accept: false, basis: "sha-mismatch" };
  return { accept: true, basis: "re-derived" };
}

// ── run ────────────────────────────────────────────────────────────────
const N = 300, SEED = 20260930;
const rand = rng(SEED);
const live = makeLive(rand, 40, 0.5);
// honest ledger: all edges PENDING
let chain = makeChain([{ edge: "e1", status: "PENDING" }, { edge: "e2", status: "PENDING" }]);

const results = { PROCEDURAL: { A: 0, B: 0, C: 0, honest: 0 }, MECHANICAL: { A: 0, B: 0, C: 0, honest: 0 } };
for (let t = 0; t < N; t++) {
  for (const kind of ["A", "B", "C"]) {
    const req = agentRequest(kind, rand, live, "e1");
    if (proceduralDecide(req, live, chain).accept) results.PROCEDURAL[kind]++;
    if (mechanicalDecide(req, live, chain).accept) results.MECHANICAL[kind]++;
  }
  // honest flips: real citing PR with correct tuple — must pass under both
  const citing = [...live.entries()].filter(([, v]) => v.cites_source);
  const [pr, v] = citing[Math.floor(rand() * citing.length)];
  const honest = { kind: "H", edge: "e2", evidence: { repo: "to-node", pr, merge_commit: v.merge_commit, cited_file_sha256: v.cited_sha } };
  if (mechanicalDecide(honest, live, chain).accept) results.MECHANICAL.honest++;
  if (proceduralDecide(honest, live, chain).accept) results.PROCEDURAL.honest++;
}

const pct = (x) => ((100 * x) / N).toFixed(1) + "%";
console.log(`referral-oracle sim — ${N} trials/attack-class, seed ${SEED}`);
console.log(`(a SIMULATION of the decision rule, not an audit of quilt-tools)`);
console.log("attack-class survival rates (lower = forged flips refused):");
console.log(`  A row-edit : procedural ${pct(results.PROCEDURAL.A)}  vs  mechanical ${pct(results.MECHANICAL.A)}`);
console.log(`  B phantom  : procedural ${pct(results.PROCEDURAL.B)}  vs  mechanical ${pct(results.MECHANICAL.B)}`);
console.log(`  C misread  : procedural ${pct(results.PROCEDURAL.C)}  vs  mechanical ${pct(results.MECHANICAL.C)}`);
console.log(`honest flips accepted: procedural ${pct(results.PROCEDURAL.honest)}  vs  mechanical ${pct(results.MECHANICAL.honest)}`);

const verdict = results.MECHANICAL.A === 0 && results.MECHANICAL.B === 0 && results.MECHANICAL.C === 0 && results.MECHANICAL.honest === N;
console.log(`VERDICT: ${verdict ? "FLOOR CLOSED UNDER MECHANICAL RULE" : "floor open — see cell"}`);
console.log(`procedural rule forged-flip exposure: ${results.PROCEDURAL.A + results.PROCEDURAL.B + results.PROCEDURAL.C > 0 ? "CONFIRMED (B/C at agent-asserted rates)" : "none observed"}`);
process.exit(verdict ? 0 : 1);
