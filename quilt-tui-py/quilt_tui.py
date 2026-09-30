#!/usr/bin/env python3
"""
quilt_tui.py — the Python/curses reference port of the quilt spreadsheet TUI.

A terminal spreadsheet whose cells are quilt cells. This port sits directly on
the kernel reference (cell_api.CellGraph): every keystroke that mutates the
fabric is an opcode, and every opcode is sealed into the chained receipt
journal exactly as the C99 kernel semantics demand. Byte-compatibility is not
a hope; it is the same object underneath.

WHAT IS REAL / NOT REAL (fleet doctrine — stated, and pinned by tests):
  REAL    : the 5 opcodes + FORGET, on kernel semantics; the receipt chain;
            formula cells (pure); edge rendering; the driver (headless mode).
  NOT REAL: auth (none, by design here); 4D addressing (flat A1 grid);
            network (none). The kernel reference carries the same limits.
"""
import hashlib
import json
import os
import sys

KERNEL = "/tmp/quilt-c"
if os.path.isdir(KERNEL) and KERNEL not in sys.path:
    sys.path.insert(0, KERNEL)

import cell_api  # the kernel reference — semantics come from here, vendored live

FORMULA_KINDS = ("sum", "product", "max", "min")


def addr_of(col: int, row: int) -> str:
    """0-indexed col,row -> A1 notation (col 0..25 -> A..Z)."""
    return f"{chr(ord('A') + col)}{row + 1}"


def rc_of(addr: str):
    return (ord(addr[0].upper()) - ord('A'), int(addr[1:]) - 1)


class Fabric:
    """Thin TUI-facing wrapper over cell_api.CellGraph.

    Adds only what the spreadsheet needs on top of the kernel: A1 addressing,
    formula-cell kinds, and FORGET (the +1 opcode — the flat reference API has
    no FORGET, so it is implemented here graph-side and journaled locally; the
    receipt carries op='FORGET' so the chain stays complete)."""

    def __init__(self):
        self.graph = cell_api.CellGraph()

    # ── opcode surface ────────────────────────────────────────────────────────
    def bind(self, addr, dials, kind="generic"):
        # args shape MUST match the kernel reference byte-for-byte for generic
        # cells ({"dials": [...]} only) or the receipt chain diverges — the
        # receipt_id is a hash of the args. kind rides along only when non-default.
        args = {"dials": list(dials)}
        if kind != "generic":
            args["kind"] = kind
        r = self.graph.op("BIND", addr, args)
        if kind in FORMULA_KINDS:
            self.recompute_formulas()
        return r["result"]

    def link(self, a, b):
        return self.graph.op("LINK", "graph", {"a": a, "b": b})["result"]

    def effect(self, addr):
        r = self.graph.op("EFFECT", addr)["result"]
        self.recompute_formulas()
        return r

    def view(self, addr):
        return self.graph.op("VIEW", addr)["result"]

    def tick(self):
        r = self.graph.op("TICK", "graph")["result"]
        self.recompute_formulas()
        return r

    def forget(self, addr):
        c = self.graph.cells.get(addr)
        if c is None:
            return {"error": "MISSING_CELL", "detail": f"no cell at {addr}"}
        for n in list(c.neighbors):
            if n in self.graph.cells and addr in self.graph.cells[n].neighbors:
                self.graph.cells[n].neighbors.remove(addr)
                self.graph.cells[n].version += 1
        del self.graph.cells[addr]
        # journal locally so the chain records the removal (kernel API lacks FORGET)
        self.graph.receipts.append({
            "schema": "quilt/cell-receipt@v1", "receipt_id": hashlib.sha256(
                json.dumps({"op": "FORGET", "addr": addr,
                            "parent": self.graph.receipts[-1]["receipt_id"] if self.graph.receipts else None},
                           sort_keys=True).encode()).hexdigest()[:16],
            "parent": self.graph.receipts[-1]["receipt_id"] if self.graph.receipts else None,
            "op": "FORGET", "addr": addr, "result": {"cell": addr, "forgotten": True},
            "graph_digest": self.graph.graph_digest(), "mutating": True, "elapsed_ms": 0.0,
        })
        return {"cell": addr, "forgotten": True}

    # ── formula cells (pure: same neighbor inputs -> same dial[0]) ────────────
    def recompute_formulas(self):
        """Recompute every formula cell (pure: neighbor inputs -> dial[0]).

        Policy, stated because it is a choice: formula evaluation is a fixed-point
        iteration (max 8 passes) and values SATURATE at the canonical encoding's
        ceiling — the C99 serializer writes 4-byte UNSIGNED ints, so the port
        clamps at 0xFFFFFFFF exactly as the kernel clamps at zero. Feedback loops
        (a sum cell that includes a product cell that multiplies it) therefore
        fail soft instead of raising OverflowError mid-frame. The demo fabric is
        wired loop-free; a looped sheet saturates, it does not crash."""
        CEIL = 0xFFFFFFFF
        for _ in range(8):
            stable = True
            for cell in self.graph.cells.values():
                if cell.kind not in FORMULA_KINDS:
                    continue
                vals = []
                for n in cell.neighbors:
                    nb = self.graph.cells.get(n)
                    if nb is not None and nb.dials:
                        vals.append(nb.dials[0])
                if not vals:
                    continue
                if cell.kind == "sum":
                    nv = sum(vals)
                elif cell.kind == "product":
                    nv = 1
                    for v in vals:
                        nv *= v
                elif cell.kind == "max":
                    nv = max(vals)
                else:
                    nv = min(vals)
                nv = max(0, min(CEIL, nv))  # saturate both ends of the unsigned-4 range
                cur = cell.dials[0] if cell.dials else None
                if cur != nv:
                    stable = False
                    if cell.dials:
                        cell.dials[0] = nv
                    else:
                        cell.dials = [nv]
                    cell.version += 1
                    cell.version_key = f"{cell.version}:{cell.state_digest()}"
            if stable:
                break


# ── headless driver (byte-compatible with the kernel reference) ────────────────

def driver_apply_script(ops):
    """Apply a JSON-lines opcode script to a fresh Fabric. Shared by tests and driver.py."""
    f = Fabric()
    for op in ops:
        o = op.get("op")
        if o == "BIND":
            f.bind(op["cell"], list(op.get("dials", [])), kind=op.get("kind", "generic"))
        elif o == "LINK":
            f.link(op["a"], op["b"])
        elif o == "EFFECT":
            f.effect(op["cell"])
        elif o == "VIEW":
            f.view(op["cell"])
        elif o == "TICK":
            f.tick()
        elif o == "FORGET":
            f.forget(op["cell"])
        else:
            f.graph.op(o, op.get("cell", "graph"), {})  # fail-closed seal under its own name
    return f


def render_digest_line(f: Fabric, op_index: int) -> str:
    """One line of driver output: op index, graph digest, tick, journal length."""
    return f"op={op_index:03d} digest={f.graph.graph_digest()} tick={f.graph.tick} journal={len(f.graph.receipts)}"


# ── the curses TUI ────────────────────────────────────────────────────────────

def run_tui(stdscr, fabric: Fabric, cols=8, rows=6):
    import curses
    curses.curs_set(0)
    cur_c, cur_r = 0, 0
    mode = "normal"          # normal | edit | link | confirm_forget
    link_src = None
    status = "arrows/hjkl move · e edit · L link · x effect · v view · t tick · d forget · q quit"
    edit_buf = ""

    CW, CH = 10, 3           # cell box width/height in chars
    OX, OY = 1, 1            # grid origin

    def cell_xy(col, row):
        return (OX + col * CW, OY + row * CH)

    def draw_box(win, col, row, cell, selected):
        x, y = cell_xy(col, row)
        attr = curses.A_REVERSE if selected else 0
        if cell is not None and cell.kind in FORMULA_KINDS and not selected:
            attr |= curses.A_BOLD
        d = cell.dials if cell is not None else []
        top = f"{addr_of(col, row):<3}v{cell.version if cell else 0:<2}"
        dials_s = "[" + ",".join(str(x) for x in d[:3])
        if len(d) > 3:
            dials_s += ",·"
        dials_s += "]"
        line1 = f"{top:<{CW - 1}}"
        line2 = f"{dials_s:<{CW - 1}}"
        try:
            win.addnstr(y, x, line1, CW - 1, attr)
            win.addnstr(y + 1, x, line2, CW - 1, attr)
            win.hline(y + 2, x, curses.ACS_HLINE, CW - 1)
        except curses.error:
            pass

    def draw_edges(win):
        """Draw LINK edges between cell centers without overwriting boxes."""
        centers = {}
        for addr, cell in fabric.graph.cells.items():
            c, r = rc_of(addr)
            if 0 <= c < cols and 0 <= r < rows:
                centers[addr] = cell_xy(c, r)
        drawn = set()
        for addr, cell in fabric.graph.cells.items():
            for n in cell.neighbors:
                key = tuple(sorted((addr, n)))
                if key in drawn or n not in centers:
                    continue
                drawn.add(key)
                (x0, y0), (x1, y1) = centers[addr], centers[n]
                x0c, y0c = x0 + CW // 2, y0 + 1
                x1c, y1c = x1 + CW // 2, y1 + 1
                # L-route: horizontal then vertical, Bresenham-lite, spaces only
                x, y = x0c, y0c
                stepx = 1 if x1c >= x else -1
                while x != x1c:
                    x += stepx
                    _edge_char(win, y, x, '-' if x != x1c else '+')
                stepy = 1 if y1c >= y else -1
                while y != y1c:
                    y += stepy
                    _edge_char(win, y, x, '|' if y != y1c else '+')
                _edge_char(win, y0c, x0c, '*')
                _edge_char(win, y1c, x1c, '*')

    def _edge_char(win, y, x, ch):
        try:
            cur = win.inch(y, x) & 0xFF
            if cur in (32, ord('-'), ord('|'), ord('+')) and ch in ('-', '|'):
                if cur != 32 and cur != ord(ch):
                    win.addch(y, x, '+', curses.A_DIM)
                else:
                    win.addch(y, x, ch, curses.A_DIM)
            elif ch == '+' and cur in (32, ord('-'), ord('|'), ord('+')):
                win.addch(y, x, '+', curses.A_DIM)
            elif ch == '*' and cur == 32:
                win.addch(y, x, '*', curses.A_DIM)
        except curses.error:
            pass

    def draw_status(win, h, w):
        addr = addr_of(cur_c, cur_r)
        cell = fabric.graph.cells.get(addr)
        if cell is not None:
            left = (f" {addr} kind={cell.kind} v{cell.version} "
                    f"digest={cell.state_digest()} dials={cell.dials}")
        else:
            left = f" {addr} (empty)"
        meta = (f"tick={fabric.graph.tick} journal={len(fabric.graph.receipts)} "
                f"gdigest={fabric.graph.graph_digest()}")
        try:
            win.addnstr(h - 3, 0, left.ljust(w), w, curses.A_BOLD)
            win.addnstr(h - 2, 0, meta.ljust(w), w)
            win.addnstr(h - 1, 0, (" " + status).ljust(w), w, curses.A_REVERSE)
        except curses.error:
            pass

    while True:
        stdscr.erase()
        h, w = stdscr.getmaxyx()
        for r in range(rows):
            for c in range(cols):
                addr = addr_of(c, r)
                draw_box(stdscr, c, r, fabric.graph.cells.get(addr), (c, r) == (cur_c, cur_r))
        draw_edges(stdscr)
        draw_status(stdscr, h, w)
        if mode == "edit":
            prompt = f" BIND {addr_of(cur_c, cur_r)} dials[,kind]> {edit_buf}"
            try:
                stdscr.addnstr(h - 1, 0, prompt.ljust(w), w, curses.A_REVERSE)
            except curses.error:
                pass
        stdscr.refresh()

        ch = stdscr.getch()
        if mode == "edit":
            if ch in (27,):
                mode, edit_buf = "normal", ""
                status = "edit cancelled"
            elif ch in (10, 13):
                try:
                    parts = [p.strip() for p in edit_buf.split(",")]
                    kind = "generic"
                    if parts and parts[-1] in FORMULA_KINDS:
                        kind = parts.pop()
                    dials = [int(p) for p in parts if p != ""]
                    fabric.bind(addr_of(cur_c, cur_r), dials, kind=kind)
                    status = f"BOUND {addr_of(cur_c, cur_r)} kind={kind} dials={dials}"
                except ValueError:
                    status = "parse error: comma-separated ints, optional trailing kind (sum|product|max|min)"
                mode, edit_buf = "normal", ""
            elif ch in (curses.KEY_BACKSPACE, 127, 8):
                edit_buf = edit_buf[:-1]
            elif 32 <= ch < 127:
                edit_buf += chr(ch)
            continue
        if mode == "link":
            if ch == 27:
                mode, link_src = "normal", None
                status = "link cancelled"
            elif ch == 10 or ch == 13:
                if link_src is None:
                    link_src = addr_of(cur_c, cur_r)
                    status = f"link from {link_src}: move to target, Enter to confirm"
                else:
                    tgt = addr_of(cur_c, cur_r)
                    if tgt != link_src:
                        r = fabric.link(link_src, tgt)
                        status = f"LINK {link_src}<->{tgt}" if "edge" in r else f"error: {r}"
                    mode, link_src = "normal", None
            else:
                cur_c, cur_r = _move(ch, cur_c, cur_r, cols, rows)
            continue
        if mode == "confirm_forget":
            if ch in (ord('y'), ord('Y')):
                r = fabric.forget(addr_of(cur_c, cur_r))
                status = f"FORGET {r.get('cell', addr_of(cur_c, cur_r))}"
            else:
                status = "forget cancelled"
            mode = "normal"
            continue

        # normal mode
        if ch in (ord('q'), 27):
            return fabric
        elif ch in (ord('h'), curses.KEY_LEFT):
            cur_c = max(0, cur_c - 1)
        elif ch in (ord('l'), curses.KEY_RIGHT):
            cur_c = min(cols - 1, cur_c + 1)
        elif ch in (ord('j'), curses.KEY_DOWN):
            cur_r = min(rows - 1, cur_r + 1)
        elif ch in (ord('k'), curses.KEY_UP):
            cur_r = max(0, cur_r - 1)
        elif ch == ord('e'):
            mode = "edit"
            edit_buf = ""
        elif ch == ord('L'):
            mode = "link"
            link_src = None
            status = "LINK: move to first endpoint, Enter to pick"
        elif ch == ord('x'):
            r = fabric.effect(addr_of(cur_c, cur_r))
            status = f"EFFECT -> {r.get('propagated_to', r)}"
        elif ch == ord('v'):
            r = fabric.view(addr_of(cur_c, cur_r))
            status = f"VIEW {r.get('cell')}: {r.get('dials')} digest={r.get('state_digest')}" if "cell" in r else f"error: {r}"
        elif ch == ord('t'):
            r = fabric.tick()
            status = f"TICK -> {r.get('tick')} cells={r.get('cells')}"
        elif ch == ord('d'):
            if addr_of(cur_c, cur_r) in fabric.graph.cells:
                mode = "confirm_forget"
                status = f"forget {addr_of(cur_c, cur_r)}? y/N"
            else:
                status = "nothing bound there"


def _move(ch, cur_c, cur_r, cols, rows):
    import curses
    if ch in (ord('h'), curses.KEY_LEFT):
        return (max(0, cur_c - 1), cur_r)
    if ch == curses.KEY_RIGHT:
        return (min(cols - 1, cur_c + 1), cur_r)
    if ch in (ord('j'), curses.KEY_DOWN):
        return (cur_c, min(rows - 1, cur_r + 1))
    if ch in (ord('k'), curses.KEY_UP):
        return (cur_c, max(0, cur_r - 1))
    return (cur_c, cur_r)


def main():
    import argparse
    ap = argparse.ArgumentParser(description="quilt-tui-py — spreadsheet over the quilt cell fabric")
    ap.add_argument("--fabric", help="demo_fabric.json to load")
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--rows", type=int, default=6)
    a = ap.parse_args()
    fabric = Fabric()
    if a.fabric:
        with open(a.fabric) as fh:
            data = json.load(fh)
        for cell in data.get("cells", []):
            fabric.bind(cell["addr"], cell.get("dials", []), kind=cell.get("kind", "generic"))
        for a_, b_ in data.get("links", []):
            fabric.link(a_, b_)
        fabric.recompute_formulas()
    import curses
    try:
        curses.wrapper(run_tui, fabric, cols=a.cols, rows=a.rows)
    except KeyboardInterrupt:
        pass
    print(f"\nfinal graph_digest={fabric.graph.graph_digest()} tick={fabric.graph.tick} journal={len(fabric.graph.receipts)}")


if __name__ == "__main__":
    main()
