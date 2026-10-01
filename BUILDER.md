# BUILDER.md — the builder daemon (`bridge/builder.mjs`)

The builder is the **claw session that lives in the agent panel**: it reads what the human
asks for in the captain's non-interrupting `/ask` channel, thinks with an LLM, BUILDS
cells + links on the fabric, and replies with a Socratic scope question. Zero npm deps
(node stdlib only). First mission run for real on 2026-09-30/10-01 (transcripts below).

```
human (web UI /ask)                      Z.ai (GLM)
  │  /tmp/canvas-web-questions.jsonl        ▲
  ▼                                         │ think (strict-JSON plan)
[builder.mjs] ── tail ─► think ─► validate ─┴─► execute ─► reply
     │              ▲            (whitelist)      │ opcodes
     │              │                             ▼
     │        live fabric state ──────────► /tmp/quilt-canvas/socks/cudaclaw.sock
     ▼                                     (controller = single authority)
/tmp/canvas-web-answers.jsonl  ◄── one JSONL line: reply + question + op receipts
```

## Architecture: tail → think → validate → execute → reply

1. **Tail** — position-tracked tail of `/tmp/canvas-web-questions.jsonl`
   (`tailOffset` = bytes consumed through the last complete newline; partial lines are
   buffered; a shrunken file is treated as truncation and rewound, with dedup via the
   answered-ts set). On startup the offset is set to the *current* file size — only
   questions appended after the builder starts are answered. Questions already answered
   are skipped by matching `ts` against every `ts`/`qts`/`question_ts` in
   `/tmp/canvas-web-answers.jsonl`. Poll: 1 s. Turns are queued sequentially
   (`turnQueue`) so concurrent questions can't interleave.
2. **Think** — before *every* turn the builder fetches live fabric state from the unix
   socket (one-shot connection: `ready` → hello `update` → close) and builds the system
   prompt fresh: role, the op contract (below), the whitelist, the port registry, and the
   current state JSON. LLM: `POST https://api.z.ai/api/coding/paas/v4/chat/completions`,
   model `glm-5-turbo`, fallback `glm-5.3-flash` on any error. The API key is read
   **at use time** from `/mnt/c/Users/casey/key.txt` (`ZAI_KEY=` line) and lives only in
   the fetch call — never logged, echoed, or stored anywhere. `max_tokens: 4000` (GLM
   reasoning tokens count against the budget; at 1500 the reasoning alone could eat the
   whole completion and return empty content — hit live, see mission log).
3. **Validate** (fail-loud, before any byte reaches the socket):
   - whitelist `{bind, link, tick}` — anything else (**FORGET**, LINK-DELETE, …) is
     REJECTED with a note;
   - `addr` must match `^[A-Z][0-9]{1,2}$`;
   - max **64 cells** total; dials numeric and ≤ 8 entries; kind a short string;
   - both link endpoints must already be bound (in the fetched state or earlier in the
     same op list);
   - plans capped at 32 ops/turn.
   Invalid ops are *skipped, not executed*, and reported honestly in the reply.
4. **Execute** — ops go over the socket in order (one connection per turn):
   `BIND → {"type":"opcode","op":"BIND","cell":A,"args":{"dials":…,"kind":…}}`,
   `LINK → {"type":"opcode","op":"LINK","cell":"graph","args":{"a":…,"b":…}}`,
   `TICK → {"type":"opcode","op":"TICK","cell":"graph","args":{}}`. After each opcode the
   builder waits for the controller's broadcast `update`, merges it, and **verifies the
   op landed** (bind: cell present with that kind; link: edge present in *either*
   orientation — the fabric's links are undirected, `_link()` wires both neighbor lists;
   tick: tick advanced). Receipts carry `ok/verified/detail/tick_after/ledger_tip`.
5. **Reply** — appended to `/tmp/canvas-web-answers.jsonl` as one line:
   ```json
   {"ts":<now>,"qts":<question ts>,"from":"builder","reply":"…","question":"…",
    "ops_applied":[…receipts…],"model":"glm-5-turbo","latency_ms":26287,"total_ms":26298}
   ```
   `ts` is *now* (spec) and `qts` is the question's ts — `web_projection.mjs`'s `/inbox`
   joins on `ts | qts | question_ts`, so both operator-style and builder-style replies
   thread correctly. Parse-fail of the model's JSON → exactly **one** corrective retry →
   if still unparseable, the builder answers honestly with the error. Model unreachable
   → honest error answer. Socket-fail → log + **exit 1** (no silent partial turns).
   Raw model output per call (content, finish reason, usage, latency) is appended to
   `/tmp/canvas-builder-llm.jsonl` for audit/docs.

## The JSON op contract (model-facing)

The model must reply with STRICT JSON, no fences:

```json
{"ops":[{"op":"bind","addr":"E4","kind":"llm","dials":[0,0,0]},
        {"op":"link","from":"E3","to":"E4"}],
 "reply":"what I built and why",
 "question":"the scope question"}
```

Ops execute in order. Port registry embedded in every prompt so kinds are meaningful:

| kind | role |
|---|---|
| `mic` | captures audio (out: audio) |
| `a2d` | audio → digital_audio |
| `stt` | digital_audio → text |
| `llm` | text → text (language model) |
| `tts` | text → digital_audio |
| `d2a` | digital_audio → analogue_audio |
| `speaker` | renders analogue audio (in: analogue_audio) |
| `mem` | text → text (memory) |
| `net` | text → text (internet access) |
| `engine` | text → text (agent engine) |

Craft rules in the prompt: bind new cells at fresh addresses in flow order (E1, E2, …);
dials are honest `[0,0,0]` placeholders (model-choice slots — never invent numbers);
**extend, never rebuild** (if the ask is already on the fabric, bind only the delta and
link into the existing chain); links are undirected (never emit the reverse of a link
already made); end with EXACTLY ONE Socratic question — simple path first (fewest
concrete choices, e.g. the three voice models stt/llm/tts + wire the hardware), richer
path offered explicitly (memory, internet, an agent engine, decomposing a larger agent).

## Safety whitelist — why FORGET is banned

Only `bind`, `link`, `tick` survive validation. **FORGET is banned forever**: one FORGET
seals its receipt with a different id formula than `_seal()` uses, so `verifyChain()`
can never replay that entry again — the PoEM gate then refuses *every* future mutation
with `LEDGER_UNVERIFIED` until the controller is restarted clean. Verified live on
2026-09-30; filed as
[SuperInstance/quilt-canvas-tui#1](https://github.com/SuperInstance/quilt-canvas-tui/issues/1)
("PoEM gate trapdoor"). The daemon rejects it even if the model asks, and reports the
rejection honestly in its reply. The fabric is append-only by law: wrong cells are
superseded, never deleted.

## Run / stop

```bash
# run (window `builder` in the canvas-ctl session; kill stale first)
tmux kill-window -t canvas-ctl:builder 2>/dev/null
tmux new-window -t canvas-ctl -n builder "cd /home/eileen/projects/quilt-canvas-tui && \
  node bridge/builder.mjs 2>&1 | tee /tmp/canvas-builder.log"

# stop
tmux kill-window -t canvas-ctl:builder

# single-instance lock (stale locks are detected via pid liveness and taken over)
/tmp/canvas-builder.lock
```

Artifacts: `/tmp/canvas-builder.log` (runtime log), `/tmp/canvas-builder-llm.jsonl`
(raw model calls), `/tmp/canvas-builder-answers-attempt1.archive.jsonl` (superseded
mission attempts, kept for the story). Answers/questions files are shared with
`web_projection.mjs` (`GET /inbox` renders the thread in the browser).

## First mission — two real turns, run for real (2026-09-30/10-01)

Turn seed 1: `{"ts":1790825008227,"addr":null,"question":"I want to build a chatbot on an
edge device with a microphone and speaker as its io.","answered":false}`
Turn seed 2: `{"ts":1790825193538,"addr":null,"question":"more to this edge agent — give
it memory and internet access.","answered":false}`

All turns used **glm-5-turbo** (fallback never needed). The workbench was also alive with
other lanes during the mission (documented below) — the daemon handled them correctly.

### Turn 1 — build the 7-cell voice chain

- Attempt 1 (latency 29.4 s): plan = 14 ops — `bind E1 mic, E2 a2d, E3 stt, E4 llm,
  E5 tts, E6 d2a, E7 speaker` (all `dials [0,0,0]`), links `E1→E2→E3→E4→E5→E6→E7`,
  `tick`. **All 14 verified** (each receipt: `ok:true`, ledger ok, tip advancing per op,
  e.g. bind E1 → `f7027b880bbe`, tick → `27fcfb9d7821`).
  Reply: "I've laid the full voice loop on the E-row: E1 captures sound, E2 digitizes it,
  E3 transcribes to text, E4 is the language model that thinks, and E5→E6→E7 synthesize
  the reply, convert it back to analogue, and play it out the speaker. E4's dials are
  empty on purpose — that's the model-choice slot…"
  Question forked on *model size* only ("smallest spool vs larger model + mem") —
  **missed the required fork** (3 models + wire hardware vs more-to-this-edge-agent).
  → **Prompt refinement #1** (one allowed): the Socratic question must be an explicit
  fork — SIMPLE path names the model slots the chain needs (a voice chain needs exactly
  three: stt, language model, tts) and wires the hardware; RICHER path offers memory /
  internet / agent engine explicitly. Attempt 1 archived, question re-seeded with the
  same ts, turn re-run.
- Attempt 2 = final (latency 26.3 s, total 26.3 s, 1 op): the model saw the live fabric
  and refused to duplicate — "Your exact system already lives on the fabric: mic → a2d →
  stt → llm → tts → d2a → speaker, wired end to end across E1–E7, so I bound nothing new
  and simply advanced the tick — duplicating that chain would be dishonest plumbing."
  Question: "Simple path: name the three models this voice chain actually needs — which
  speech-to-text, which small on-device language model, and which text-to-speech should
  fill E3, E4, and E5 — and I'll wire the backend around your choices; or take the
  richer path and I first extend the fabric with persistent memory, internet access, or
  a full agent engine at fresh cells (E8 onward). Which way do we go?" — **fork hit**.

### Turn 2 — memory + internet

- Attempt 1: **both models returned empty completions** (HTTP 200, `finish` consumed by
  reasoning). Raw usage from the successful turns showed completion_tokens ≈ 1400 with
  ≈ 1000 reasoning tokens against the old `max_tokens: 1500` ceiling → raised to 4000.
  The builder did the designed thing: honest error answer
  ("I could not reach the model backend: empty completion"), no fabric ops. Archived.
- Attempt 2 (latency 47.5 s, 7 ops): **built the delta** — `bind E8 mem`, `bind E9 net`,
  `link E4→E8`, `link E4→E9`, plus the model's two redundant reverse links
  (`E8→E4`, `E9→E4`) and a `tick`. Binds + forward links verified; the reverse links
  were flagged "failed" by the builder's ordered-pair check — **builder bug, not model
  error**: `fabric._link()` is undirected (both neighbor lists get wired), so the edges
  had landed. → **Fix #2**: link verification accepts either orientation; prompt now
  states links are undirected (never emit the reverse). Attempt archived.
- Attempt 3 = final (latency 38.1 s, 1 op): with E8/E9 already on the append-only
  fabric, the model confirmed instead of rebuilding — "You're already covered — E8 is
  bound as a mem cell and E9 as a net cell, and both are linked straight into the voice
  agent's language model at E4… Nothing needs rebuilding; I just advanced the tick to
  log the confirmed wiring." Question: "Simplest path to a working edge agent: name the
  three model slots this voice chain needs — which stt model for E3, which language
  model for E4, and which tts for E5 — and I'll wire the hardware around them; or the
  richer path: should I bind an agent-engine cell at E10 that plans multi-step replies
  by routing through E8's memory and E9's net?"

Raw LLM JSON for the mission turns (verbatim, from `/tmp/canvas-builder-llm.jsonl`;
each line below = one model call):

```json
{"ops":[{"op":"bind","addr":"E1","kind":"mic","dials":[0,0,0]},{"op":"bind","addr":"E2","kind":"a2d","dials":[0,0,0]},{"op":"bind","addr":"E3","kind":"stt","dials":[0,0,0]},{"op":"bind","addr":"E4","kind":"llm","dials":[0,0,0]},{"op":"bind","addr":"E5","kind":"tts","dials":[0,0,0]},{"op":"bind","addr":"E6","kind":"d2a","dials":[0,0,0]},{"op":"bind","addr":"E7","kind":"speaker","dials":[0,0,0]},{"op":"link","from":"E1","to":"E2"},{"op":"link","from":"E2","to":"E3"},{"op":"link","from":"E3","to":"E4"},{"op":"link","from":"E4","to":"E5"},{"op":"link","from":"E5","to":"E6"},{"op":"link","from":"E6","to":"E7"},{"op":"tick"}],"reply":"I've laid the full voice loop on the E-row: E1 captures sound, E2 digitizes it, E3 transcribes to text, E4 is the language model that thinks, and E5→E6→E7 synthesize the reply, convert it back to analogue, and play it out the speaker. E4's dials are empty on purpose — that's the model-choice slot, and nothing else on the fabric was disturbed or forgotten.","question":"For E4, do we take the simple path — wiring it to the smallest spool already on the fabric (A3's qwen2.5-0.5b) so the whole loop runs offline on-device — or the richer path, a larger model plus a mem cell so it remembers the conversation?"}
```
(turn 1 attempt 1: glm-5-turbo, 29355 ms, 1394 completion tok / 969 reasoning)

```json
{"ops":[{"op":"tick"}],"reply":"Your exact system already lives on the fabric: mic → a2d → stt → llm → tts → d2a → speaker, wired end to end across E1–E7, so I bound nothing new and simply advanced the tick — duplicating that chain would be dishonest plumbing. The hardware path is complete; what's empty are the three model slots at E3 (stt), E4 (llm), and E5 (tts).","question":"Simple path: name the three models this voice chain actually needs — which speech-to-text, which small on-device language model, and which text-to-speech should fill E3, E4, and E5 — and I'll wire the backend around your choices; or take the richer path and I first extend the fabric with persistent memory, internet access, or a full agent engine at fresh cells (E8 onward). Which way do we go?"}
```
(turn 1 final: glm-5-turbo, 26287 ms, 1186 completion tok / 986 reasoning)

```json
{"ops":[{"op":"bind","addr":"E8","kind":"mem","dials":[0,0,0]},{"op":"bind","addr":"E9","kind":"net","dials":[0,0,0]},{"op":"link","from":"E4","to":"E8"},{"op":"link","from":"E8","to":"E4"},{"op":"link","from":"E4","to":"E9"},{"op":"link","from":"E9","to":"E4"},{"op":"tick"}],"reply":"Extended the live E-chain agent instead of rebuilding: bound E8 (mem) and E9 (net) at the next free addresses and wired both to the language model at E4 — memory reads and writes in a loop so context persists, and the net link carries queries out and fetched answers back. The idle F-chain copy stays untouched. Dials are honest [0,0,0] model-choice slots, waiting on real picks.","question":"Simple path first: name the three models for the voice slots — stt at E3, language model at E4, tts at E5 — and say whether E8's memory persists to a local file or lives in-session. Or take the richer path: bind an engine cell at E10 to route memory and web calls itself, decomposing a larger agent onto this device. Which fork, and if simple, which three models?"}
```
(turn 2 build: glm-5-turbo, 47498 ms, 2102 completion tok / 1807 reasoning — would have
been empty at the old 1500 cap)

```json
{"ops":[{"op":"tick"}],"reply":"You're already covered — E8 is bound as a mem cell and E9 as a net cell, and both are linked straight into the voice agent's language model at E4, so it can read past context and pull from the internet mid-conversation. Nothing needs rebuilding; I just advanced the tick to log the confirmed wiring.","question":"Simplest path to a working edge agent: name the three model slots this voice chain needs — which stt model for E3, which language model for E4, and which tts for E5 — and I'll wire the hardware around them; or the richer path: should I bind an agent-engine cell at E10 that plans multi-step replies by routing through E8's memory and E9's net?"}
```
(turn 2 final: glm-5-turbo, 38135 ms, 1641 completion tok / 1474 reasoning)

### State proof (after the mission, `curl localhost:8799/state.json`)

- Cells: `E1 mic, E2 a2d, E3 stt, E4 llm, E5 tts, E6 d2a, E7 speaker, E8 mem, E9 net`
  (plus the pre-existing A/T/B lanes and the externally-built F/G lanes below).
- E-links: `E1→E2, E2→E3, E3→E4, E4→E5, E4→E8, E4→E9, E5→E6, E6→E7`
  = full chain E1→…→E7 **plus llm↔mem (E4–E8, undirected) and llm→net (E4→E9)**. ✓
- `tick: 7`, `ledger.ok: true`, tip `37c46266516a6088` — chain unbroken.

### Latency per turn (glm-5-turbo, coding endpoint)

| turn | attempt | latency | ops | outcome |
|---|---|---|---|---|
| 1 | 1 | 29.4 s | 14/14 verified | chain built; fork missed → prompt refined once |
| 1 | 2 (final) | 26.3 s | 1 (tick) | fork hit; no rebuild |
| 2 | 1 | 73.3 s | 0 | both models empty-completion → honest error answer |
| 2 | 2 | 47.5 s | 4 verified + 2 reverse-flagged | E8/E9 built+linked; verifier bug found+fixed |
| 2 | 3 (final) | 38.1 s | 1 (tick) | confirm + next fork question |

### Bonus proof: the daemon handled live outside traffic mid-mission

While the mission ran, the captain drove the workbench directly: a "workbench check"
question asked for an F-lane chain (the builder continued it from the pre-bound F1/F2 —
bound F3–F7, linked F2→…→F7, 27.5 s, all verified), and G-lane cells appeared via
socket chips. The builder processed every queue in order without dropping or
interleaving a turn.

## Gotchas hit live (beyond HARNESS.md)

1. **GLM reasoning eats max_tokens**: at `max_tokens: 1500`, glm-5-turbo's reasoning
   (~1000 tok typical) can consume the budget and return empty `content`. Use ≥ 4000.
2. **Fabric links are undirected**: `LINK a→b` wires `a.neighbors += b` *and*
   `b.neighbors += a`. Emitting the reverse link is redundant; verifiers must accept
   either orientation.
3. **Append-only means "already built" is a valid outcome**: after a retry/re-seed the
   model sees its prior work and confirms instead of rebuilding — that's correct
   behavior on a FORGET-banned fabric, and the receipts of the original build live in
   the earlier answer line (archived, not deleted).
4. **Re-running a turn**: questions are deduped by `ts`; to replay a turn, archive the
   old answer line, restart the daemon (fresh tail position + in-memory dedup), and
   re-append the question with the *same* ts.
