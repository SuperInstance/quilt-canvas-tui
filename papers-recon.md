# papers-recon.md — Lane E: research sweep feeding the fleet (2026-09-30)

Sweep of five areas the roadmap names. Every entry: what it is, where it
lands on a fleet lane, and an honest status (READ = abstract+survey read;
CITED = one hop from a secondary source; QUEUED = title only).

## 1. Iterative refinement loops (feeds: experiment lanes, snowball)

- **Self-Refine → Reflexion → CRITIC → Self-RAG → PRMs lineage** (2023-26).
  CITED via o-mega/taskade surveys. The load-bearing finding for us:
  *intrinsic self-critique without external grounding degrades* (Huang et al.
  2024, confirmed repeatedly 2026). Our FAIL-first pins + receipt chains ARE
  the grounding — the fleet's loops are CRITIC-shaped, not Self-Refine-shaped.
  READ (survey level).
- **Calibration-first self-improvement** (arxiv 2606.14211, 2026): train the
  agent's *reflection* to judge its own correctness against environment
  feedback, then use calibrated reflections as pseudo-rewards. Directly
  translatable: our `ledger confidence` field could be calibrated against
  later replay outcomes — a qcells-flavored exp. QUEUED for close read.
- **Verification@K with attempt-level weighting** (arxiv 2604.17912, 2026):
  optimizes sequential retries under hard verifier feedback. Our exp034/035
  pair-gate work is the hypothesis-testing twin of this. CITED.
- **Denoising iterative self-correction** (2606.21724) + "feedback over form"
  (2604.21950): structured verification loops beat pipeline topology changes.
  Field reads smooth — consistent with exp035's "below pair resolution".
  CITED.

## 2. MAP-Elites / quality-diversity advances (feeds: qcells, room-grid)

- **MEMES** (Flageat/Lim/Cully, GECCO'24): up to ~100 parallel ES emitters,
  exploit vs explore split, independent resets. This is the *lane-scheduling*
  idea inside QD — our async lane fleet is MEMES-shaped at the org level.
  READ (abstract+analysis).
- **Multi-Emitter MAP-Elites** (Cully): a bandit selects among heterogeneous
  emitters per situation. Candidate for LaneAllocator: replace round-robin
  lane picks with a small bandit over lane archetypes (auditor/scout/builder).
  QUEUED.
- **VQ-Elites** (2025): unsupervised behavioral descriptors — no predefined
  grid. Speaks to our "descriptor-free diversity" instincts in FluxVectorTable.
  CITED.
- **MESB (sliding boundaries)** in FPS map generation (2605.30570, May 2026):
  grid boundaries that move with the distribution. Interesting for
  FluxVectorTable where niche geometry is hand-drawn. QUEUED.
- **MOME-PGX**: policy-gradient assistance inside multi-objective MAP-Elites.
  Cross with the gradient lanes question. CITED.

## 3. Multi-agent lane scheduling / bandit compute allocation

- **RT-MAPF budget allocation** (arxiv 2507.16874v2, Feb 2026): explicitly
  budgets planning per agent; a real-time multi-armed bandit adapts policy.
  The cleanest published version of "don't just run everything and halt at
  budget" — our epics>15min guard is the naive version; this is the upgrade.
  READ (abstract+conclusion).
- **Learning to Schedule Online Tasks with Bandit Feedback** (AAMAS 2024):
  bandit feedback for online task scheduling. Direct prior art for a
  FleetConductor allocator. CITED.
- **Meta-RL for budget/capacity-constrained multi-agent MDPs** (Vora/Ornik
  2025): LSAP grouping by time-to-failure diversity + per-group PPO. The
  "diversity in expected failure" grouping principle applies to lane teams.
  CITED.

## 4. Verifier-guided iteration (feeds: test_compiler gates, Dafny/spec lanes)

- **DafnyBench / AxDafny / AutoSpec / Laurel / Preguss** lineage: iterative
  verifier feedback loops for program verification. VeriSkill (2607.27733,
  Jul 2026) self-evolves verification skills. If a spec-lane opens in the
  fleet, this is the syllabus. CITED.
- **FoPSS 2026 LLM-Verifier Interface** (github.com/namin/llm-verifier-interface):
  course repo. "Adopt on green, reject and roll back" as the self-edit gate —
  exactly our FAIL-first doctrine in their words. READ (repo skim).
- **Self-edit gate pattern** (DGM/STOP/SICA/Gödel Agent survey): the gate is
  always external verification; documented failure mode is self-editing the
  improvement machinery (Gödel Agent). Fleet parallel: never let a lane relax
  its own gates. READ (survey level).

## 5. Agent-cognition-as-material / skill libraries (feeds: chiaroscuro
##    bidirectional feeds, quilt-skills cross-abstraction study)

- **SAGE** (Dec 2025/Mar 2026): agents write reusable functions, validate,
  persist to a library; +8.9% goal completion, **−59% output tokens** —
  skills compound into efficiency, not just accuracy. This is the quantified
  argument for the user's "quilt-skills from another abstraction" doctrine.
  READ (survey level).
- **Agent Skills open standard** (Dec 2025): cross-vendor skill portability —
  the quilt-skill exchange format already exists. CITED.
- **ICLR 2026 RSI workshop** framing: "loops that actually get better — and
  can show it." Our receipt/digest culture is the showing. CITED.

## What changes on the roadmap because of this sweep

1. LaneAllocator gets a real citation stack (MEMES + RT-MAPF bandit +
   AAMAS'24) — upgrade from guard-rail to published-shape allocator. NEXT.
2. exp036 candidate: calibrate `ledger confidence` against replay truth
   (calibration-first self-improvement). QUEUED behind Casey merges.
3. FluxVectorTable: read VQ-Elites + MESB before the next niche-geometry
   decision. QUEUED.
4. The fleet's gates stay external per the self-edit-gate survey — document
   this in ROADMAP as doctrine, not preference.
