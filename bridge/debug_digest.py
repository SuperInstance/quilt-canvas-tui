import sys, json
sys.path.insert(0, "/tmp/quilt-c")
import cell_api

g = cell_api.CellGraph()
ops = json.loads(open("/tmp/quilt-canvas/quilt-tui-py/ops_fixed6.json").read())
for op in ops:
    o = op["op"]
    if o == "BIND": g.op("BIND", op["cell"], {"dials": list(op["dials"])})
    elif o == "LINK": g.op("LINK", "graph", {"a": op["a"], "b": op["b"]})
    elif o == "EFFECT": g.op("EFFECT", op["cell"])
    elif o == "TICK": g.op("TICK", "graph")
    elif o == "VIEW": g.op("VIEW", op["cell"])

parts = []
for addr in sorted(g.cells):
    c = g.cells[addr]
    parts.append(f"{addr}|{c.kind}|{json.dumps(c.dials)}|{json.dumps(sorted(c.neighbors))}|v{c.version}")
print(json.dumps(";".join(parts) + f";tick={g.tick}"))
for addr in sorted(g.cells):
    c = g.cells[addr]
    print(addr, "kind=", c.kind, "dials=", json.dumps(c.dials), "nb=", json.dumps(c.neighbors), "v=", c.version)
print("python digest:", g.graph_digest(), "tick:", g.tick, "receipts:", len(g.receipts))
