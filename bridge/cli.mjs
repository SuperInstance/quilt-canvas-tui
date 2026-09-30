#!/usr/bin/env node
// cli.mjs — quilt-canvas CLI (claude-canvas shape):
//   node cli.mjs show sheet --scenario live --config fabric.json   → run canvas HERE
//   node cli.mjs spawn sheet --scenario live --config fabric.json  → print the tmux split cmd
// The spawn verb does NOT exec tmux itself — the caller (an agent) decides.
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [verb, kind, ...rest] = process.argv.slice(2);

function opt(name, dflt) {
  const eq = rest.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const i = rest.indexOf(`--${name}`);
  if (i >= 0 && rest[i + 1] !== undefined && !rest[i + 1].startsWith("--")) return rest[i + 1];
  return dflt;
}
const scenario = opt("scenario", "live");
const config = opt("config", "");
const id = opt("id", "default");

if (verb === "show" && kind === "sheet") {
  const args = [path.join(HERE, "canvas.mjs"), `--scenario=${scenario}`, `--id=${id}`];
  if (config) args.push(`--fabric=${config}`);
  process.env.QUILT_SOCK = `/tmp/quilt-canvas/socks/${id}.sock`;
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 0);
} else if (verb === "spawn" && kind === "sheet") {
  const canvasEntry = path.join(HERE, "canvas.mjs");
  const sock = `/tmp/quilt-canvas/socks/${id}.sock`;
  const fabricFlag = config ? ` --fabric=${config}` : "";
  // what an agent would run to get controller + canvas side by side in tmux:
  const cmd = [
    `tmux new-session -d -s quilt-${id} 'node ${HERE}/controller.mjs' \\;`,
    `split-window -h 'QUILT_SOCK=${sock} node ${canvasEntry}${fabricFlag}' \\;`,
    `select-pane -t 0`,
  ].join(" ");
  console.log(`# quilt-canvas spawn: controller + canvas in a tmux split (id=${id})`);
  console.log(`# socket: ${sock}  (localhost-only filesystem socket, no auth — design probe)`);
  console.log(cmd);
} else {
  console.error("usage: node cli.mjs <show|spawn> sheet --scenario live [--config fabric.json] [--id NAME]");
  process.exit(2);
}
