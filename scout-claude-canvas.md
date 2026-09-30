# Scout H — claude-canvas (dvdsgl/claude-canvas) protocol extraction

PoC, MIT, Bun + ink TUI. Canvases = tmux split panes rendering interactive React TUI, controlled by "controller" (Claude / CLI) over **Unix domain sockets, NDJSON framing** (`JSON.stringify(msg)+"\n"`, buffer split on `\n`). Socket path convention: `/tmp/canvas-${id}.sock` (world-readable /tmp, fully predictable). **No auth anywhere** — no token, no peer check; canvas auto-`ready`s to whoever listens.

## Transport
- Server: `Bun.listen({unix})` (ipc/server.ts); Client: `Bun.connect({unix})` + `connectWithRetry` (10 tries, 100 ms) (ipc/client.ts).
- Parse errors surface via `onError` only; malformed lines never kill the connection.

## Protocol table (typed union in ipc/types.ts)

| Direction | type | Fields | Meaning |
|---|---|---|---|
| C→V | `close` | — | canvas exits (via `useApp().exit()`) |
| C→V | `update` | `config: unknown` | push new config, live re-render |
| C→V | `ping` | — | health check |
| C→V | `getSelection` | — | RPC: current selection |
| C→V | `getContent` | — | RPC: content + cursor |
| V→C | `ready` | `scenario: string` | sent immediately on connect |
| V→C | `selected` | `data: unknown` | user selection; resolves RPC, closes |
| V→C | `cancelled` | `reason?: string` | Esc/quit; resolves RPC cancelled |
| V→C | `error` | `message: string` | resolves RPC failure |
| V→C | `pong` | — | ping reply |
| V→C | `selection` | `{selectedText,startOffset,endOffset}\|null` | getSelection reply |
| V→C | `content` | `{content,cursorPosition}` | getContent reply |

C=controller, V=canvas/view. Selection data = raw-text byte offsets (use-text-selection.ts).

## Two connection modes
1. **Controller-as-server** (main path, api/canvas-api.ts `spawnCanvasWithIPC`): id=`${kind}-${Date.now()}-${rand36}`; controller listens; canvas connects; first of `selected`/`cancelled`/`error`/`disconnect`/`timeout(5min default)` resolves exactly once (`resolved` guard). 
2. **Canvas-as-server** (standalone CLI, use-ipc-server.ts): canvas listens, `broadcast()` to all clients; CLI `update|selection|content <id>` fire one-shot requests (2 s timeout; `update` responses ignored).

## Spawn mechanics (terminal.ts)
- Requires tmux (`$TMUX`); `spawn` → `run-canvas.sh show <kind> --id --config --socket --scenario` → `bun run src/cli.ts`.
- tmux `split-window -h -p 67` (canvas 2/3 width); `-P -F #{pane_id}` captured; **single global** `/tmp/claude-canvas-pane-id` → reuse path: send `C-c`, sleep 150 ms, `send-keys "clear && cmd" Enter`.
- Config JSON passed via temp file `/tmp/canvas-config-${id}.json` (`--config "$(cat …)"`) to dodge shell escaping.
- Window title set via ANSI `\x1b]0;canvas: <kind>\x07`. Cursor hidden/restored via ANSI on exit.
- Registry: `renderCanvas` switch on kind; scenarios keyed `"canvasKind:scenarioName"` (registry.ts): calendar:display|meeting-picker, document:display|edit|email-preview, flight:booking.

## Canvas → controller payloads (what comes BACK)
Selection (text+offsets), content+cursor, scenario-defined `selected` payloads, cancelled/error. **No opcodes, no binary frames, no incremental deltas** — full-config `update` only.

## Auth
**None.** Predictable socket path in shared /tmp is the only access control. Trust is one-way and eager: canvas `ready`s any listener.

## Frailties worth noting
- `send()` silently drops when disconnected; `update` CLI never reads acks.
- 150 ms sleep-based pane reuse is racy; pane-id file is singleton + stale-prone.
- Timeout path sends `close` but never verifies the canvas died (orphan panes).
- Any local process can pre-bind `/tmp/canvas-<id>.sock` (MITM the controller).
