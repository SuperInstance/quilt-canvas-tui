#!/usr/bin/env node
// op.mjs — one-liner fabric ops for agents. Zero deps. Kills the 5-line socket boilerplate.
// Wire contract: HARNESS.md — {"type":"opcode","op":...,"cell":...,"args":{...}} over
// unix socket /tmp/quilt-canvas/socks/cudaclaw.sock (env QUILT_SOCK overrides).
//
// usage:
//   op.mjs bind <addr> --kind <kind> [--dials 1,2,3]
//   op.mjs link <a> <b>
//   op.mjs tick [cell=graph]
//   op.mjs view <cell>
//   op.mjs state                 # compact fabric JSON {tick,ledger,cells,links}
//   op.mjs cell <addr>
//   op.mjs ask "<question>" [--wait <sec=120>]   # post to the panel inbox, wait for builder/operator reply
//   op.mjs inbox                 # unanswered questions
//   op.mjs answers [n=3]
//   op.mjs forget ...            # REFUSED. always. exit 2.
import net from 'node:net';
import fs from 'node:fs';

const SOCK = process.env.QUILT_SOCK || '/tmp/quilt-canvas/socks/cudaclaw.sock';
const QUESTIONS = '/tmp/canvas-web-questions.jsonl';
const ANSWERS = '/tmp/canvas-web-answers.jsonl';
const die = (msg, code = 1) => { console.error('op: ' + msg); process.exit(code); };

if (process.argv[2] === 'forget') {
  console.error('op: FORGET is banned — one forget seals an unverifiable receipt and bricks the ledger (PoEM gate trapdoor).');
  console.error('    If a cell is wrong, rebind it in place (bind same addr, new kind/dials). Archive, never erase.');
  process.exit(2);
}

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  args.splice(i, 1);
  return args[i] !== undefined ? args.splice(i, 1)[0] : def;
};

// one socket session: send opcodes, resolve on the matching update broadcast
function socketTurn(opcodes, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK);
    let buf = '';
    const sent = [];
    const fail = (e) => { try { s.destroy(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error('socket timeout ' + timeoutMs + 'ms')), timeoutMs);
    s.on('connect', () => { for (const o of opcodes) s.write(JSON.stringify(o) + '\n'); });
    s.on('error', fail);
    s.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'update') {
          sent.push(m);
          if (sent.length >= opcodes.length) { clearTimeout(timer); s.destroy(); resolve(sent); }
        }
      }
    });
  });
}

const prettyCell = (c) => ({ addr: c.addr, kind: c.kind, dials: c.dials });

try {
  switch (cmd) {
    case 'bind': {
      const addr = args[0]; const kind = opt('--kind', 'generic');
      const dials = (opt('--dials', '0,0,0')).split(',').map(Number);
      if (!/^[A-Z][0-9]{1,2}$/.test(addr || '')) die('bad addr ' + addr + ' (want like E4)');
      const [u] = await socketTurn([{ type: 'opcode', op: 'BIND', cell: addr, args: { dials, kind } }]);
      const c = u.cells.find((x) => x.addr === addr);
      console.log(JSON.stringify({ ok: !!c, tick: u.tick, cell: c ? prettyCell(c) : null, ledger: u.ledger }));
      break;
    }
    case 'link': {
      const [a, b] = args;
      const [u] = await socketTurn([{ type: 'opcode', op: 'LINK', cell: 'graph', args: { a, b } }]);
      console.log(JSON.stringify({ ok: u.links.some((l) => l.includes(a) && l.includes(b)), tick: u.tick, links: u.links.length, ledger: u.ledger }));
      break;
    }
    case 'tick': {
      const cell = args[0] || 'graph';
      const [u] = await socketTurn([{ type: 'opcode', op: 'TICK', cell, args: {} }]);
      console.log(JSON.stringify({ ok: true, tick: u.tick, ledger: u.ledger }));
      break;
    }
    case 'view': {
      const [u] = await socketTurn([{ type: 'opcode', op: 'VIEW', cell: args[0] }]);
      console.log(JSON.stringify({ tick: u.tick, inspector: u.inspector ?? null, cell: u.cells.find((x) => x.addr === args[0]) }));
      break;
    }
    case 'state': {
      const [u] = await socketTurn([{ type: 'opcode', op: 'VIEW', cell: 'graph' }]);
      console.log(JSON.stringify({ tick: u.tick, ledger: u.ledger, cells: u.cells.map(prettyCell), links: u.links }));
      break;
    }
    case 'cell': {
      const [u] = await socketTurn([{ type: 'opcode', op: 'VIEW', cell: 'graph' }]);
      const c = u.cells.find((x) => x.addr === args[0]);
      if (!c) die('no cell ' + args[0]);
      console.log(JSON.stringify({ ...prettyCell(c), links: u.links.filter((l) => l.includes(args[0])) }));
      break;
    }
    case 'ask': {
      const waitSec = Number(opt('--wait', 120));
      const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();
      if (!question) die('ask needs a question');
      const ts = Date.now();
      fs.appendFileSync(QUESTIONS, JSON.stringify({ ts, addr: null, question, answered: false }) + '\n');
      console.error(`op: question posted (ts=${ts}), waiting up to ${waitSec}s for a reply…`);
      const t0 = Date.now();
      let pos = fs.existsSync(ANSWERS) ? fs.readFileSync(ANSWERS, 'utf8').length : 0;
      while (Date.now() - t0 < waitSec * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const data = fs.existsSync(ANSWERS) ? fs.readFileSync(ANSWERS, 'utf8') : '';
        const fresh = data.slice(pos); pos = data.length;
        for (const line of fresh.split('\n')) {
          if (!line.trim()) continue;
          let a; try { a = JSON.parse(line); } catch { continue; }
          if (a.qts === ts) {
            console.log(JSON.stringify({ answered: true, by: a.from, reply: a.reply, question: a.question ?? null, ops_applied: a.ops_applied ?? [], latency_ms: a.latency_ms ?? null }));
            process.exit(0);
          }
        }
      }
      console.log(JSON.stringify({ answered: false, ts, note: 'no reply within ' + waitSec + 's — check `op.mjs inbox`' }));
      process.exit(0);
      break;
    }
    case 'inbox': {
      const qs = fs.existsSync(QUESTIONS) ? fs.readFileSync(QUESTIONS, 'utf8').trim().split('\n') : [];
      const seen = new Map();
      for (const l of qs) { let q; try { q = JSON.parse(l); } catch { continue; } if (!seen.has(q.ts)) seen.set(q.ts, q); }
      const answers = fs.existsSync(ANSWERS) ? fs.readFileSync(ANSWERS, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
      for (const [ts, q] of seen) {
        const rep = answers.find((a) => a.qts === ts);
        console.log(`${rep ? 'ANS' : 'un '} ${ts} by=${rep ? rep.from : '-'} ${(q.question || '').slice(0, 80)}`);
      }
      break;
    }
    case 'answers': {
      const n = Number(args[0] || 3);
      const lines = fs.existsSync(ANSWERS) ? fs.readFileSync(ANSWERS, 'utf8').trim().split('\n') : [];
      for (const l of lines.slice(-n)) console.log(l);
      break;
    }
    default:
      die('unknown command ' + cmd + ' — see header comment for usage');
  }
} catch (e) {
  die(e.message);
}
