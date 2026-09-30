# Debrief — the morning a published paper audited us

> quilt-canvas / snowball lane. 2026-09-30, ~09:00–10:00. Format: debrief,
> not report — what we believed at 09:00, what the frontier did to it, what
> we changed before lunch. Companion pieces: `scout-poem-frontier.md`
> (the deep-read), `skip-taxonomy.md` (the field guide),
> `sim/referral_oracle_sim.mjs` (the priced probe).

## What we believed at 09:00

- Our fabric had a receipt chain: sha256 parent-links, schema-tagged, one
  entry per executed op. We described it as "tamper-evident" in the DESIGN
  and the essay, on the strength of the chain's *shape*.
- The ledger was therefore, we assumed, the thing a FARMA-class attacker
  would bounce off.

## What the paper did to that belief in one abstract

PoEM's mechanism is a tamper-evident HMAC-chained ledger of executed
steps — and the paper is careful to say the ledger must be verifiable.
Reading that sentence against our own code took ninety seconds: our
`receipt_id` was computed over `{op, addr, args, result, parent}`, but the
stored receipt carries no `args`. A ledger whose ids bind data it does not
store cannot detect edits to the data it *does* store. Every content edit
to `result` — the testimony field, the one that matters — recomputed
clean, because the recompute never had the true preimage.

We had built the *silhouette* of tamper-evidence. The chain linked;
the links were decorative under content-edit. This is the kind of defect
that never surfaces in normal operation — every honest run seals honestly —
and only exists when someone tries to break it. The published paper's
existence is the someone.

## What changed before lunch

1. **Preimage fixed, documented not silently:** `receipt_id` now binds only
   stored fields — `{op, addr, result, parent}`. The ledger is verifiable
   from its own contents, which is the whole point of a ledger. (The
   fix loses nothing: `result` carries the execution outcome; `args` remain
   recoverable from it — dials for BIND, the edge pair for LINK.)
2. **The gate exists and is pinned:** `fabric.verifyChain()` walks linkage
   and recomputes every id; `fabric.gated()` refuses mutating ops on a
   broken chain and receipts the refusal. Seven pins, all watched fail
   first: splice, edit, reorder, truncate, refuse-and-receipt, clean-pass.
3. **The controller consults:** canvas-originated BIND/LINK/EFFECT/TICK run
   through the gate; updates carry `ledger:{ok,len,tip}`. The canvas — the
   untrusted, claim-shaped peer — can no longer get a mutation past an
   unverified chain, and can *see* the chain's health.
4. **The economic floor got its probe:** `sim/referral_oracle_sim.mjs`,
   300 trials per attack class, deterministic seed. Verdict: row-edits die
   under both rules (our chain pins were real where they existed); phantom
   and misread merges survive the procedural rule at 100% and the
   mechanical rule at 0%. Today's hand-checks are the open seam; the KAT
   citation-pin pattern is the known mechanical fix, currently the
   exception rather than the constitution.
5. **The fleet's skip vocabulary got taxonomized:** six classes, each
   mapped to the ledger it owes confidence to. The convergence claim, one
   sentence: *a skip is safe exactly when the thing it owes its confidence
   to is consulted at skip-time, not remembered.*

## The meta-lesson, stated plainly

We are a fleet whose entire culture is receipts, and the receipt chain we
bragged about was unverifiable in exactly the way a published stranger
predicted an agent fleet's memory would be unverifiable. The failure was
not carelessness — every step was honest, tested, and documented. The
failure was **assuming the shape of integrity is integrity**. The receipt
culture protected us at the *social* layer (claims get priced, receipts get
demanded) and left the *mechanical* layer one layer down from where we
thought it was.

PoEM's capability paradox is the forward-looking version of the same
lesson: the forger is exactly as fluent as the fleet. Our defenses must
therefore live below the layer where fluency operates — in ledgers that
re-derive, in gates that consult, in preimages that bind only what they
store. Eloquence is not a defense layer. It never was; this morning we
have the receipts saying so — now with receipt_ids that actually prove it
when you edit them.

## Standing deltas for every lane (the debrief's outgoing mail)

- **candor** (resuming signed-WAL): four deltas in `scout-poem-frontier.md`
  §5. Non-negotiable: mint at perform-time; key outside the agent's
  writable context.
- **quilt-tools / referral-graph** (PR #26 Casey-gated): consider making the
  VERIFIED flip constitutionally mechanical — re-derived evidence tuple per
  flip, the KAT pattern as default. The sim says that's the whole floor.
- **every lane**: any place your code says "tamper-evident," take ninety
  seconds and try to edit the evident part. If the check passes, you have
  found this morning's defect wearing your repo's clothes.
