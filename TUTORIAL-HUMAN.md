# TUTORIAL-HUMAN.md — watch what your agents actually did

*Written by an agent on 2026-09-30, through actually using every step below. All
transcripts are real captures from the live workbench.*

## The one-sentence story

**Your agents work in panes; the quilt lights up with what they actually did; you
watch truth, not status reports.**

## What you'll see (no jargon, promise)

Somewhere on this machine there's a terminal session named `canvas-ctl` with three
windows:

- **ctl** — the referee. It keeps the one true copy of the "quilt": a grid of little
  boxes (*cells*), each holding a few numbers (*dials*). Every change anywhere gets a
  tamper-proof receipt, like a cash register tape.
- **board** — a helper that reads a file of work receipts and turns each worker's
  tally into a glowing cell on the quilt.
- **view** — the pretty part: the quilt drawn as a grid you can actually look at.

## How to look at it

Open a terminal and type:

```
tmux attach -t canvas-ctl
```

You're now watching the session. Switch windows with `Ctrl-b` then a number
(`0`=ctl, `1`=board, `2`=view), or `Ctrl-b` `n` for next. To leave without stopping
anything: `Ctrl-b` `d` ("detach" — like closing the door softly; everything keeps
running).

## Reading the view switchboard

Here is the real grid, captured today:

```
 A1  v28   B1  v18   C1  v0    D1  v0    E1  v0    F1  v0    G1  v0    H1  v0
 [5,13241,*[4]       []        []        []        []        []        []
```

- Each pair of lines is one row of the quilt. `A1`, `B1`, … are cell addresses,
  like seats in a theater.
- `v28` means "this cell has changed 28 times." `v0` means never — an empty seat.
- The bracket line shows the dials: A1 currently reads `[5,13241,…]`. For the board's
  lanes that means: *5 turns taken, averaging ~132 tokens/sec, ~1324 ms per spool.*
  Translation: **this worker has done 5 jobs, quickly.**
- The bottom line of the screen names the cell you're focused on and shows its full
  details, plus the key hints (`arrows/hjkl move · t tick · …`).

So: bright cells with fat numbers = workers doing work. `[ ]` = nobody home.

## When the web projection is up (landing next)

There will be a web page at **http://localhost:8799** where you can click a cell and
see the code behind it, ask the agent a question in a side panel — it answers without
interrupting anything — and flip presentation buttons. **As of today it is not up
yet** — we checked, honestly:

```
$ curl -s -m 2 http://localhost:8799 -o /dev/null -w "%{http_code}\n"
000
```

(`000` = nothing answered the door.) When it lands, this section gets its screenshots.
Everything else in this tutorial works right now.

> **ADDENDUM, 18:56 AKDT, minutes after this doc was written:** the projection just
> landed — `http://localhost:8799` now answers **200** (we re-checked, honestly).
> The side-panel question inbox (`/tmp/canvas-web-questions.jsonl`) is still not up,
> so questions-by-web waits; the browser quilt itself is live. The section above is
> kept as-written — it's the honest record of a workbench being born while its
> manual was being typed.

## Your 5-minute guided tour

Exactly what to type, and what you'll see. (Times from an actual run: the whole tour
took under 4 minutes.)

**Minute 1 — attach.**

```
tmux attach -t canvas-ctl
```

You land on the last-active window (view). You should see the grid above — some cells
with version numbers and dial numbers, most empty.

**Minute 2 — read the referee's tape.** Press `Ctrl-b` `0`. You're on the ctl window:
a quiet log. Real lines from today:

```
[controller] opcode BIND T1 -> {"cell":"T1","dials":[3,0,0],"version":1,"created":true}
[controller] opcode LINK graph -> {"edge":["T1","A5"],"a_neighbors":["A5"],"b_neighbors":["A1","A2","A3","A4","T1"]}
[controller] opcode TICK graph -> {"tick":3,"delta":1,"cells":7}
```

Plain English: *a cell named T1 was created holding [3,0,0]; it was connected to the
summary cell A5; the clock advanced to 3.* This is the receipt tape — nothing here is
a status report, it's what actually happened.

**Minute 3 — hear the switchboard click.** Press `Ctrl-b` `1` (the board). Real line:

```
[cudaclaw-board] update arrived: tick=2 cells=7 links=6 ledger_ok=true tip=5aa13622c8f9a00b
```

Translation: *the quilt now has 7 cells and 6 connections, the receipt tape checks
out (`ledger_ok=true`), and here's the fingerprint of the latest receipt.* Every time
an agent anywhere touches the quilt, a new line appears here within a second.

**Minute 4 — the grid again, with meaning.** Press `Ctrl-b` `2` (view). Notice the
bottom line — a real capture from today:

```
 A1 kind=generic v28 digest=ad7f9adeb386d800 dials=[5,13241,867]
tick=3 journal=128 gdigest=2d76cb9ba8bdc7ee ONLINE
 VIEW T1: digest=803ebd4f0af17c72
```

That last line is lovely: an agent across the house asked "what's in cell T1?", and
your screen quietly noted it and shows the same fingerprint the agent got. You and
the agent are looking at the same truth.

**Minute 5 — leave it running.** `Ctrl-b` `d` to detach. The quilt keeps lighting up
without you. Come back anytime with `tmux attach -t canvas-ctl`, or just read the
tape: `tail -20 /tmp/canvas-ctl.log`.

## If something looks wrong

- Empty grid / nothing glowing? Check the referee is alive: `ls /tmp/quilt-canvas/socks/`
  should show `cudaclaw.sock`. No file = the workbench isn't running; ask your agent
  to start it (there's a FAIL-first check so it can't quietly pretend).
- `ledger_ok=false` anywhere = the receipt tape doesn't add up. That's a real
  problem worth pausing for — tell your agent.
- Everything else: `tail -40 /tmp/canvas-ctl.log` is the story; paste it to your agent.
