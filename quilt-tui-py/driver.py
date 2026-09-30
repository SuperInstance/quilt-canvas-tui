#!/usr/bin/env python3
"""
driver.py — headless opcode-script runner for the quilt-tui Python port.

Reads a JSON-lines opcode script on stdin, applies it through the SAME Fabric
the TUI uses, and prints one state line per op. Byte-compatibility with the
kernel reference is a tested property of Fabric, not a claim.

Script format (one JSON object per line):
  {"op":"BIND","cell":"A1","dials":[1,2],"kind":"generic"}
  {"op":"LINK","a":"A1","b":"B2"}
  {"op":"EFFECT","cell":"A1"}
  {"op":"VIEW","cell":"A1"}
  {"op":"TICK"}
  {"op":"FORGET","cell":"A1"}
"""
import json
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from quilt_tui import Fabric, render_digest_line


def load_fabric(path):
    fabric = Fabric()
    with open(path) as fh:
        data = json.load(fh)
    for cell in data.get("cells", []):
        fabric.bind(cell["addr"], cell.get("dials", []), kind=cell.get("kind", "generic"))
    for a_, b_ in data.get("links", []):
        fabric.link(a_, b_)
    fabric.recompute_formulas()
    return fabric


def main():
    ap = argparse.ArgumentParser(description="headless opcode-script driver for quilt-tui-py")
    ap.add_argument("--fabric", help="demo_fabric.json to load before the script")
    a = ap.parse_args()
    fabric = load_fabric(a.fabric) if a.fabric else Fabric()
    idx = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            op = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"op={idx:03d} ERROR bad-json: {e}")
            idx += 1
            continue
        o = op.get("op", "?")
        if o == "BIND":
            fabric.bind(op["cell"], list(op.get("dials", [])), kind=op.get("kind", "generic"))
        elif o == "LINK":
            fabric.link(op["a"], op["b"])
        elif o == "EFFECT":
            fabric.effect(op["cell"])
        elif o == "VIEW":
            fabric.view(op["cell"])
        elif o == "TICK":
            fabric.tick()
        elif o == "FORGET":
            fabric.forget(op["cell"])
        else:
            fabric.graph.op(o, op.get("cell", "graph"), {})
        print(render_digest_line(fabric, idx))
        idx += 1
    print(f"final digest={fabric.graph.graph_digest()} tick={fabric.graph.tick} journal={len(fabric.graph.receipts)}")


if __name__ == "__main__":
    main()
