import { Fabric, FIXED_6OP, applyScript } from "./fabric.mjs";

const f = applyScript(new Fabric(), FIXED_6OP);
const pyArr = (a) => "[" + a.join(", ") + "]";
const parts = [];
for (const addr of [...f.cells.keys()].sort()) {
  const c = f.cells.get(addr);
  parts.push(`${addr}|${c.kind}|${pyArr(c.dials)}|${pyArr([...c.neighbors].sort())}|v${c.version}`);
}
console.log(JSON.stringify(parts.join(";") + `;tick=${f.tick}`));
for (const [a, c] of f.cells) console.log(a, "kind=", c.kind, "dials=", JSON.stringify(c.dials), "nb=", JSON.stringify(c.neighbors), "v=", c.version);
console.log("node digest:", f.graphDigest(), "tick:", f.tick, "receipts:", f.receipts.length);
