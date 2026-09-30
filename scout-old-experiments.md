# scout-old-experiments.md — the June strata, deep-read + quilt-native upgrade map

Recon 2026-09-30, main session (spawn SCARF; lanes opened → doctrine: sequential when needed).
Survey: org experiment-filter, 128 repos total. Page 4 (by last update) = the June 2026
stratum: the oxide family (~30 small Rust probes of GPU-infra mechanisms with ternary
{-1,0,+1} state), plus four load-bearing monuments. Deep-reads below; the rest mapped
from descriptions.

## The load-bearing four

### 1. entropy-conservation — the mathematics of certainty
**What they were doing:** Shannon entropy H = −Σ pᵢ log₂ pᵢ over a system's
verification paths (test branches, proof obligations); the meta-law dH/dt ≤ 0 —
well-maintained systems get more certain over time. Seven modules: entropy
(Shannon/Rényi/Tsallis), conservation tracker, flow network with Kirchhoff's law,
entropy gradient descent (suggests refactors), Hodge decomposition (structural vs
accidental vs topological entropy), persistence homology (Betti numbers over the
verification space), spectral analysis (Laplacian gap → mixing-time bounds).
Nine tested properties, MIT.
**The gap:** the math has no instrument. H is computed from hand-fed coverage
vectors; no repo, fleet, or experiment graph was ever measured with it.
**Quilt next level:** the fabric + journal IS the missing instrument.
- Verification paths = LINKs; path probabilities = dial-mass distribution.
  exp036 (already DRAWN) becomes: measure dH/dt over MicroMoth-quilt's real PR
  history — each merged PR = version, suite branches = paths. A conservation-law
  experiment with a named law, a real corpus, and a byte-exact ledger. This is
  "calibrated ledger confidence" with teeth.
- Hodge on the experiment graph: our SCARF faces are the harmonic component —
  cycles that are divergence-free and curl-free, unremovable by refactoring.
  exp029-vs-033/035 named in the exact vocabulary the June builders built.
- Conservation ladder for the fabric: mass (done) → receipt coverage → entropy.
  Each is a pinned invariant over the same journal.

### 2. agent-ensemble — emergence is measurable
**What they were doing:** three coordination strategies (uncoordinated /
orchestrated / musical) over N agents × T ticks. Musical wins: emergence
= group_output / best_individual > 1.0, statistically significant (50 trials),
and *scales with ensemble size* — duo < quintet < octet. Sibling crates name
the whole music-theory family: agent-groove (pocket), phrasing, intonation,
orchestration, counterpoint. "Not philosophy — measurement."
**The gap:** it was a simulation with invented agents. The claim "this IS how
agent fleets should coordinate" was never run against a real fleet's history.
**Quilt next level:** rerun it on ourselves. The Cocapn pulse lanes already
operate musical-style (lanes listen via pulses, time their builds to open
windows, leave space — no conductor). Harvest our own receipt timestamps into
the ensemble metrics: emergence = receipts/day vs best single lane; sync
accuracy = interleaving without collision (we have exp006's unaided-crossing
and today's 3-lane parallel morning as raw data). The claim stops being a
metaphor on a README and becomes a measured property of this fleet — with the
chiaroscuro projection as its live score.

### 3. metal-lathe — the research wheel
**What they were doing:** OBSERVE → QUESTION → HYPOTHESIZE → DESIGN → TEST → FEED
as an executable loop. Content-addressed observations (with surprise flags),
7 question-generation patterns (surprise clustering, 2σ anomalies, conservation
violations, cross-repo isomorphism, hardware scaling, power-law degree,
tripartite HARDCODE/MODEL/CACHED balance), hypotheses with priors, designed
experiments as runnable Python, results fed back as observations. Companion:
spectral conservation verification — γ + η = C (growth + dissipation = const),
Laplacian leakage ‖Lf‖ as the budget-leak detector.
**The gap:** it exec()s code on local disk with no chain of custody. Hypotheses,
experiments, and results are dataclasses in one process's memory — exactly the
pre-quilt world.
**Quilt next level:** the snowball-queue already runs the wheel (observation =
pulse findings; question = ranked queue; design = FAIL-first pins; test = tmux
receipt; feed = the next pulse). Mature step: make the wheel's artifacts fabric
citizens — hypothesis cells (formula kind, value = priced claim per scout-qthe),
experiment cells bound as receipts, verdicts as EFFECTs, successor spec as a
WITNESS-LINK to the next cell (scout-quilt-research-canons). Then "show all
priced hypotheses with no settled experiment" is one fabric query — the
research-director view, composable with everything else.

### 4. The oxide family — thirty isolated mechanisms, one missing plane
**What they were doing:** each crate = one GPU-infra mechanism as a small ternary
state machine, "measured, not guessed" culture: oxide-ring (lossless event log
until overflow), oxide-journal (WAL: replay/verify/checkpoint/compaction),
oxide-checkpoint (incremental snapshots, hash verification, rollback),
oxide-tombstone (lazy deletion, watermark purge), oxide-gradient (ternary search
as gradient), oxide-energy-balance (conservation as runtime invariant),
oxide-raft-log, oxide-crdt-style health monitor, ~23 more (barriers, slotmap,
lease-grid, canary, loadshed, capacity, federation, tenancy, compile-cache...).
**The gap:** no shared substrate. Each is a correct little machine; results live
in per-crate READMEs; nothing composes them into a system of record.
Cross-mechanism invariants (journal + checkpoint + tombstone = a recoverable
state machine; energy-balance + gradient = conservation-preserving optimization)
are never pinned anywhere.
**Quilt next level:** the fabric is the integration plane they were missing.
Each mechanism = a cell kind; each crate's test run = a receipt; cross-crate
invariants = formula cells pinned FAIL-first across the family. The oxide
family becomes one fabric with thirty organs instead of thirty orphans —
and the June "conservation-law" tag on half the crates gets a real ledger to
conserve on.

## Synthesis — what the June builders were really doing
Read together, the strata tell one story: four independent attempts to build
the same four walls of the quilt. Certainty math without substrate
(entropy-conservation). Emergence proof without a real ensemble
(agent-ensemble). The wheel without a chain of custody (metal-lathe). The
machines without a machine-room (oxide). The mature quilt understanding —
fabric + journal + receipts + projections — is precisely the missing building
each was reaching for. "Taking the experiments to the next level" is not
resurrecting them; it is completing them: point each one's mature math at the
substrate we now have, and let their claims finally be measured on real data.

## Ranked next-level builds (priced, FAIL-first, one session each)
1. **exp036 = dH/dt on MicroMoth-quilt PR history** — entropy-conservation's
   law on our own ledger. Data: existing merged PRs. Law named. Instrument
   exists. (Named in ROADMAP M4; upgraded from DRAWN to SPECCED.)
2. **Ensemble-on-real-pulses** — harvest lane timestamps → emergence/sync
   metrics on this fleet's actual history. Answers agent-ensemble's open claim.
3. **Lathe-as-fabric** — port one snowball-queue cycle into fabric cells
   (hypothesis/priced, experiment/receipt, verdict/EFFECT, successor/LINK).
4. **Oxide invariant pin** — journal+checkpoint+tombstone recoverable-state-
   machine invariant as one formula cell; FAIL-first across the three crates'
   public APIs.

## Honest ledger
- Deep-reads: entropy-conservation, agent-ensemble, metal-lathe (READMEs,
  full). Oxide family: descriptions + tags only — one family deep-read
  (oxide-journal) recommended before build #4.
- Page 4 filter shows 30 repos; pages 1–3 (128 total) include quilt-research-canons,
  qthe, harness-experiments, fleet-experiments, lau-conservation-experiment —
  the later strata already surveyed by other lanes today.
- Nothing here was executed; this is understanding-first, per the captain's order.
