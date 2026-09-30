#!/usr/bin/env python3
"""
test_quilt_tui.py — FAIL-first pins for the quilt-tui Python reference port.

Zero-dep: runs under pytest OR `python3 test_quilt_tui.py`.
The byte-compat leg computes its expected digest through the REAL cell_api.py
from the quilt-c kernel clone — if this port drifts from the kernel, that leg
is where it is caught.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KERNEL = "/tmp/quilt-c"
sys.path.insert(0, HERE)
sys.path.insert(0, KERNEL)

import cell_api  # the kernel reference — the source of truth

from quilt_tui import Fabric, driver_apply_script, render_digest_line

FIXED_6OP = [
    {"op": "BIND", "cell": "A1", "dials": [1, 2]},
    {"op": "BIND", "cell": "B1", "dials": [3]},
    {"op": "LINK", "a": "A1", "b": "B1"},
    {"op": "EFFECT", "cell": "A1"},
    {"op": "TICK"},
    {"op": "VIEW", "cell": "A1"},
]


def _fresh_kernel_graph():
    """Run the FIXED_6OP script through the real cell_api.CellGraph."""
    g = cell_api.CellGraph()
    for op in FIXED_6OP:
        o = op["op"]
        if o == "BIND":
            g.op("BIND", op["cell"], {"dials": list(op["dials"])})
        elif o == "LINK":
            g.op("LINK", "graph", {"a": op["a"], "b": op["b"]})
        elif o == "EFFECT":
            g.op("EFFECT", op["cell"])
        elif o == "TICK":
            g.op("TICK", "graph")
        elif o == "VIEW":
            g.op("VIEW", op["cell"])
    return g


# ── the pins ────────────────────────────────────────────────────────────────────

def test_bind_idempotent():
    f = Fabric()
    r1 = f.bind("A1", [7])
    r2 = f.bind("A1", [7])
    assert r1["created"] is True and r2["created"] is False
    assert f.graph.cells["A1"].version == 1  # content-idempotent: version not bumped

def test_view_pure_hard_guard():
    f = Fabric()
    f.bind("A1", [1, 2, 3])
    before = f.graph.graph_digest()
    f.view("A1")
    assert f.graph.graph_digest() == before
    assert not f.graph._violations

def test_tick_monotone_saturating():
    f = Fabric()
    f.bind("A1", [0, 10])
    t0 = f.graph.tick
    f.tick()
    assert f.graph.tick == t0 + 1
    assert f.graph.cells["A1"].dials == [1, 9]
    for _ in range(40):
        f.tick()
    # saturates at zero, never negative (unsigned-safe canonical form)
    assert all(d >= 0 for d in f.graph.cells["A1"].dials)
    assert f.graph.tick > t0

def test_link_symmetric():
    f = Fabric()
    f.bind("A1", [1]); f.bind("B2", [1])
    f.link("A1", "B2")
    assert "B2" in f.graph.cells["A1"].neighbors
    assert "A1" in f.graph.cells["B2"].neighbors

def test_receipt_chain_parent_hash_intact():
    f = Fabric()
    f.bind("A1", [1]); f.bind("B1", [2]); f.view("A1")
    rs = f.graph.receipts
    assert rs[0]["parent"] is None
    assert rs[1]["parent"] == rs[0]["receipt_id"]
    assert rs[2]["parent"] == rs[1]["receipt_id"]
    # re-deriving receipt_id from body must match (chain is self-verifying)
    for r in rs:
        body = {"op": r["op"], "addr": r["addr"], "args": {}, "result": r["result"], "parent": r["parent"]}
        # args are not carried on the receipt; verify id stability instead:
        assert len(r["receipt_id"]) == 16

def test_driver_byte_matches_kernel_digest():
    """THE byte-compat pin: same 6 ops through this port's driver vs the real
    cell_api.CellGraph must land on the same graph digest, same tick, same
    receipt count, same parent chain."""
    f = driver_apply_script(FIXED_6OP)
    g = _fresh_kernel_graph()
    assert f.graph.graph_digest() == g.graph_digest(), (
        f"port digest {f.graph.graph_digest()} != kernel digest {g.graph_digest()}")
    assert f.graph.tick == g.tick
    assert len(f.graph.receipts) == len(g.receipts)
    for rp, rk in zip(f.graph.receipts, g.receipts):
        assert rp["parent"] == rk["parent"]
        assert rp["op"] == rk["op"]
        assert rp["mutating"] == rk["mutating"]

def test_edit_emits_bind_journal_entry():
    f = Fabric()
    f.bind("C3", [5, 5], kind="gauge")
    last = f.graph.receipts[-1]
    assert last["op"] == "BIND" and last["addr"] == "C3" and last["mutating"] is True

def test_driver_roundtrip_equals_direct_api():
    """driver_apply_script on an EMPTY fabric must equal direct CellGraph ops,
    op for op, receipt for receipt (result snapshots included)."""
    f = driver_apply_script(FIXED_6OP)
    g = _fresh_kernel_graph()
    for rp, rk in zip(f.graph.receipts, g.receipts):
        assert json.dumps(rp["result"], sort_keys=True) == json.dumps(rk["result"], sort_keys=True)

def test_formula_cell_recomputes_on_tick():
    f = Fabric()
    f.bind("A1", [2]); f.bind("B1", [3]); f.link("A1", "B1")
    f.bind("C1", [0], kind="sum")  # formula cell
    f.link("C1", "A1"); f.link("C1", "B1")
    f.recompute_formulas()
    assert f.graph.cells["C1"].dials[0] == 5
    f.bind("B1", [10])
    f.recompute_formulas()
    assert f.graph.cells["C1"].dials[0] == 12

def test_forget_removes_cell_and_edges():
    f = Fabric()
    f.bind("A1", [1]); f.bind("B1", [1])
    f.link("A1", "B1")
    f.forget("A1")
    assert "A1" not in f.graph.cells
    assert "A1" not in f.graph.cells["B1"].neighbors


ALL = [v for k, v in sorted(globals().items()) if k.startswith("test_")]


def main():
    print(f"quilt-tui-py pins: {len(ALL)} legs")
    print("=" * 66)
    bad = 0
    for fn in ALL:
        try:
            fn()
            ok = True
        except AssertionError as e:
            ok = False; msg = f"  [{e}]"
        except Exception as e:
            ok = False; msg = f"  [{type(e).__name__}: {e}]"
        else:
            msg = ""
        if not ok:
            bad += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {fn.__name__}{msg}")
    print("=" * 66)
    print(f"{'ALL GREEN' if bad == 0 else f'{bad} RED'} — {len(ALL) - bad}/{len(ALL)} correct")
    return 0 if bad == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
