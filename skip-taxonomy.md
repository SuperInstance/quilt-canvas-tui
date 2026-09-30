# The Skip Taxonomy — what agent fleets skip, and what a forged skip costs

> Lane: quilt-canvas / snowball. Date: 2026-09-30. Mark: **SHAPED**
> (research pass over the fleet's own corpus; the classes are observed, the
> defenses are assessed, the gaps are named). Source corpus: this fleet's
> memory files, snowball-queue, qcells lab notes, scout deliverables —
> searched for the skip vocabulary ("already …", "do not rerun", "as
> recorded", "never self-upgrade"). Companion: `scout-poem-frontier.md`
> (PoEM is the paper; this is the field guide).

## The frame

PoEM gates one skip: *skip a safety step*. Working fleets skip hundreds of
things a day, each justified by an "already …" — and every one of those
"already"s is either a **ledger confirmation** (something out there records
that it happened; consulting it is cheap) or a **claim** (a well-shaped
sentence in somebody's context). FARMA at the fleet layer is the industrial
production of the second kind. The taxonomy below names what we skip, what
ledger each skip owes its confidence to, and whether our instruments close
the forged version today.

## Class 1 — Sealed / already-receipted

- **Corpus examples**: "exp030 already validated", "sealed as MicroMoth-quilt
  PR #14 (fb6c25a)", "flagged do-not-rerun".
- **Skip**: re-executing an experiment whose receipt exists.
- **Ledger owed**: the merged PR on GitHub (the merge commit, the receipt
  file in-tree). Consulting it is one `gh` call.
- **Forged version**: "sealed as PR #N" where N doesn't exist, was closed
  unmerged, or the in-tree file doesn't contain the quoted hashes.
- **Current defense**: PROCEDURAL. Seals are checked by hand at pulse time;
  no mechanical re-derivation pins the quoted commit→tree→hash chain on
  every "sealed" claim. *Open seam — the exact B/C shape from
  `sim/referral_oracle_sim.mjs`.*

## Class 2 — Already-cited / already-referenced

- **Corpus examples**: "already referenced as receipts consumer; first
  cross-…", "already cites the canonical source".
- **Skip**: re-verifying that a citation exists and says what memory says.
- **Ledger owed**: the cited file at the cited commit (sha256).
- **Forged version**: citation exists but at a different commit, or names
  the source without the load-bearing sentence.
- **Current defense**: MECHANICAL where the KAT citation-pin pattern holds
  (the to-node's repo pins repo+commit+sha256 in a pinned test — jev-quilt
  #47 shipped exactly this). Else procedural. *Partially closed; the pattern
  should be the constitution, not the exception.*

## Class 3 — Doctrine reuse

- **Corpus examples**: "it reuses an already-proven doctrine" (qcells first
  move), "per exp012 doctrine", "exp015/016 archive regime".
- **Skip**: re-deriving or re-testing the inherited principle.
- **Ledger owed**: the experiment corpus backing the doctrine (sealed
  receipts, the named experiments, their verdicts).
- **Forged version**: doctrine attributed to an experiment that concluded
  something narrower (our own exp018 "rescue is not a rescue" was exactly a
  correction of an overclaimed reuse).
- **Current defense**: receipts exist per-experiment and are canon-checked
  at review; but nothing mechanically verifies that a *doctrine citation*
  matches the sealed verdict's scope. *Open seam, medium value — the
  mis-scope is our own historical failure mode (exp015→exp018).*

## Class 4 — State claims ("already easy / already drifted / already done")

- **Corpus examples**: "already easy" (qcells fitness-landscape reads),
  "already drifted", "already resolved", "already open", "already stale".
- **Skip**: re-measuring the state; the adjective carries the decision.
- **Ledger owed**: the measurement that earned the adjective.
- **Forged version**: the adjective from a context window where it was true
  yesterday (drifted-back-into-truth is the nastiest form: the claim
  *became* false after it was uttered).
- **Current defense**: weakest in the fleet. Adjectives travel without
  receipts by design (they're context lubricant). *Open seam; mitigation is
  cultural — price adjectives at decision points — not yet instrumental.*

## Class 5 — Process skips (queue-level)

- **Corpus examples**: "queue drained", "Casey-blocked", "skip offline
  checks", ">15min rule, deferred".
- **Skip**: re-scanning the queue / re-attempting the blocked item.
- **Ledger owed**: the queue file + the PR list as of now.
- **Forged version**: "Casey-blocked" claimed for a PR that merged an hour
  ago (the 09:25 pulse caught exactly this: jev-quilt#47 had merged 00:18Z
  while the queue still said PENDING — honest staleness, but the same shape
  as a forged block).
- **Current defense**: pulses re-derive on a schedule; staleness is
  bounded by pulse cadence, not eliminated. *Acceptable: the skip is cheap
  to reverse (one re-scan) and the pulse interval bounds the damage.*

## Class 6 — Declared skips (the legitimate kind)

- **Corpus examples**: "SKIP, never vacuous pass", "skip never" pins,
  honest-skip suite entries with the reason recorded in-band.
- **Skip**: anything, with the reason written where the skip is recorded.
- **Why it's safe**: the skip is a first-class ledger entry, not an absence
  of entry. It can be audited; it testifies about itself.
- **This is the pattern the other five classes should converge on**: every
  "already …" in fleet speech wants to become either a ledger confirmation
  (Class 2's mechanical rule) or a declared skip with its reason priced.

## The convergence claim (SHAPED, priced)

Six classes collapse to one rule: **a skip is safe exactly when the thing it
owes its confidence to is consulted at skip-time, not remembered.** Where
consultation is mechanical (chain pins, citation pins, receipt files) the
forged version dies at machine speed. Where it's procedural ("I checked"),
the forged version survives at the forger's fluency — which, per PoEM's
capability paradox, is our own fluency. The fleet's skip surface is
therefore not a list of habits to fix but a coverage map of one rule:
*consult, don't remember.* The sim in `sim/referral_oracle_sim.mjs` is the
300-trial priced version of that sentence for Class 2; Classes 1, 3, 4 are
the open work, ranked by blast radius: Class 1 (seals) first — it's the
currency the whole fleet denominates in.

*Falsifier for this taxonomy: exhibit a seventh class observed in corpus
that does not reduce to consult-don't-remember. The corpus search was
greedy over our own fleet's vocabulary; other fleets' skip dialects are a
research lane of their own.*
