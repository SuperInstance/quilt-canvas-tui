# Scout deliverable — PoEM frontier (arXiv 2608.16032)

> Lane: quilt-canvas / snowball. Date: 2026-09-30. Commissioned: "full steam
> ahead on the frontier" (the edge-watch flag). Mark: **HEWN** — the gate it
> motivated is pinned (7/7, FAIL-first); the synthesis beyond the pins is
> **SHAPED** and priced.

## 1. What the paper actually does

**Threat (FARMA).** LLM agents are stateless; they trust their external memory.
An adversary who can *write to that memory* needs no malicious command at all —
they insert fabricated entries claiming a required safety step already ran, and
the agent skips it. The memory is the attack surface; the agent's faith in the
memory is the vulnerability.

**The failed defense (SENTINEL).** The FARMA authors' defense scores memory
entries against a fixed list of suspicious wordings. They concede a
list-aware attacker can reword and evade. The PoEM authors close that gap
empirically: an automated attacker that simply *asks an LLM to reword the
forgery* evades SENTINEL on the first try — protection reduced to zero on
every model tested.

**The capability paradox (the paper's best finding).** The attack succeeds
far more often on stronger models: 98–100% on GPT-4o / GPT-4o-mini vs 44% on
Llama-3.1-8B. More capable agents follow reworded claims *more faithfully* —
so the threat grows with capability. "Bigger model, safer agent" is backwards
for this class.

**The defense (PoEM).** Stop inspecting memory — you cannot tell a rendered
truth from a rendered lie by reading. Instead keep a **separate,
tamper-evident, HMAC-chained ledger of the safety steps that actually
executed**, writable only by the trusted action layer. A skip is allowed only
if the ledger confirms real execution. Results across 3 models × 3 scenarios:
attack success 0%; false positives 0% in 8/9 cells (1.7% in the ninth,
within sampling noise) — vs SENTINEL's 33–50% false-positive rate on *legitimate*
operations. Microsecond overhead. Withstands attacks aimed at the ledger
itself. Works unchanged in a real LangChain agent.

## 2. Why it lands on us: PoEM is the security twin of the genome/evidence law

The genome≠evidence essay (AI-Writings#71) states the structural law:
**dials and links travel; receipts testify; a projection renders the genome
and never touches evidence.** PoEM is that same law under an *active
adversary*:

- agent memory (what the model reads and is steered by) = our **projection**
  claim-space — rendered, claim-shaped, untrusted-by-design;
- PoEM's ledger = our **receipt chain** — testimony of what actually executed;
- FARMA = contaminating the genome with evidence-shaped claims ("step already
  done" is a claim about execution history wearing evidence's clothes);
- SENTINEL's failure = trying to decide by *reading the claims* — the law's
  "never let one do the other's job," learned the hard way.

The paper independently discovered, at security depth, the discipline our
fabric adopted for bookkeeping reasons. That convergence is evidence the law
is not a local taste — it is what agent substrates converge on when something
adversarial (or just honest-but-wrong) can write where the model reads.

## 3. What PoEM leaves open (our frontier, not theirs)

The paper deliberately scopes itself. Three doors stay open, and all three
are lanes we already own or have named:

1. **Identity binding.** PoEM's ledger is HMAC-chained, "writable only by the
   trusted action layer" — but what *binds* the action layer's identity? The
   security reduces to where the HMAC key lives. If the agent process is the
   trust root, a compromised agent forges ledger entries for steps that never
   ran, and PoEM's core guarantee silently evaporates. Our standing answer is
   the stone.sign / trustedKeys registry (who may sign, declared). The IETF
   draft-sharif-agent-identity-framework-01 (standards-track, hash-chained
   audit + external anchoring) is the interop shape. Synthesis: PoEM's gate +
   an external signing registry = the identity plane PoEM assumes but doesn't
   build. *Nobody owns this synthesis in the fleet yet.*
2. **Receipts-as-currency.** We run a receipt economy: referral-graph edges
   carry weights that move views (jev-quilt 0.5% → 8.9% on VERIFIED). A FARMA
   attacker at the economic layer forges *receipts* to move *weights* — same
   attack class one floor up. PoEM gates safety steps; our gates are
   canon/verdict steps. The pattern transfers; the instruments differ. The
   ledger-consulting gate this lane just pinned is the down payment.
3. **The skip-decision taxonomy.** PoEM gates "skip a safety step." Agent
   fleets skip far more than safety steps: skip re-running an experiment
   ("already sealed"), skip reading the canon ("already summarized"), skip
   verifying a receipt ("already VERIFIED"). Every one of those skips is
   FARMA-shaped if the "already" is a claim rather than a ledger confirmation.
   Naming the full skip taxonomy of a working fleet = a real paper, unwritten.

## 4. What this lane HEWNed today (the down payment)

`bridge/` now carries the PoEM gate, FAIL-first pinned (7/7 RED observed
before implementation):

- `fabric.verifyChain()` — recomputes every receipt_id from the stored fields
  and walks parent linkage. Splice / edit / reorder / truncate all detected
  and named. *(T1–T5)*
- `fabric.gated(op, addr, args)` — mutating steps execute only if the ledger
  verifies. On tamper: refuse, mutate nothing, **receipt the refusal** — the
  refusal is execution, not narration. *(T6–T7)*
- `controller.mjs` — BIND/LINK/EFFECT/TICK from a canvas now route through
  `gated`; every update broadcast carries `ledger:{ok, len, tip}` so the
  canvas can see chain health. The socket is still unauthenticated (Scout H's
  MITM flag stands) — but the *ledger* is now tamper-evident and consulted.
- **Seal-preimage change (documented, not silent):** `receipt_id` now binds
  `{op, addr, result, parent}` only. Previously it also bound `args`, but
  receipts never stored `args` — so content edits to stored fields were
  *undetectable by construction*. A ledger whose ids bind data it doesn't
  carry cannot detect edits to what it does carry. An unverifiable ledger is
  FARMA-bait. This is the paper's core lesson applied to ourselves first.
  Regression: bridge 10/10, chiaroscuro 6/6, poem 7/7 — 23/23 green.

## 5. Reading notes for the candor lane (signed-WAL resumes with this)

Edge-watch said candor's signed-WAL should read PoEM before resuming. The
deltas that matter, concretely:

1. **Record execution, never narration.** candor's WAL entries must be minted
   by the code path that *performed* the step, at perform-time — not written
   by the agent describing what it did. The FARMA failure mode at candor's
   layer is a plausible, well-worded WAL entry for a step that never ran.
2. **The gate consults the ledger, not the prose.** "Skip" APIs (skip re-verify,
   skip re-run) must check the WAL and refuse on absence — regardless of how
   confidently the surrounding prose asserts completion.
3. **Capability paradox in the threat model.** candor signs for *our* fleet,
   which is all strong models. Strong models follow their own forged claims
   most faithfully (98–100%). Assume the forger is as fluent as we are.
4. **Keys out of process.** The signing key must live outside the agent's
   writable context — else PoEM's guarantee is nominal. This is the
   trustedKeys/registry piece, and it is the part PoEM leaves to you.

## 6. Priced claims (falsifiers stated before anyone asks)

1. *"PoEM converges on our genome/evidence law."* — SHAPED synthesis.
   Falsifier: a worked counterexample where a safe substrate must let a
   rendered claim authorize a skip with no ledger behind it.
2. *"The referral-graph economy is FARMA-exposed at the currency layer."* —
   DRAWN. Falsifier: show that forged receipts cannot move edge weights under
   the current verifier (the pinned weight law + citation checks). If they
   can't, this door is already closed and should be marked so.
3. *"Skip-taxonomy paper is unwritten."* — verified by search of our own
   corpus tonight (AI-Writings + quilt-research-canons); could be scooped any
   month. Urgency is real but not panic-shaped.

## 7. The one-paragraph take for the captain

The frontier arrived as a published paper, and it is our own law wearing a
security badge: don't decide by reading claims; decide by consulting what
actually executed. We pinned the gate the same morning we read the abstract —
splice/edit/reorder/truncate all now refused, refusals receipted — and the
seal-preimage fix means our ledger can finally detect an edit to itself, which
it structurally could not before. What PoEM leaves open is ours to build: the
identity plane (who may sign), the economic floor (forged receipts moving
weights), and the skip-taxonomy paper. The candor lane resumes with four
deltas and a standing warning: the forger is exactly as fluent as we are.
