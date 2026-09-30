#!/bin/bash
# start_board2.sh — canvas needs QUILT_SOCK env (argv is IGNORED: canvas.mjs reads process.env.QUILT_SOCK)
pkill -f "fleet_boar[d]" 2>/dev/null
pkill -f "controller.ms[j]" 2>/dev/null
sleep 0.5
tmux kill-session -t qdog 2>/dev/null
cd /home/eileen/scratch/quilt-canvas-tui/bridge || exit 1
QUILT_SOCK=/home/eileen/tmp/quilt-fleet.sock setsid node fleet_board.mjs > /home/eileen/tmp/fleet_board.log 2>&1 < /dev/null &
sleep 1
tmux new-session -d -s qdog -x 110 -y 30
tmux send-keys -t qdog "cd /home/eileen/scratch/quilt-canvas-tui/bridge && QUILT_SOCK=/home/eileen/tmp/quilt-fleet.sock node canvas.mjs" Enter
sleep 4
echo "=== FLEET BOARD (cells mode) ==="
tmux capture-pane -t qdog -p | head -10
echo "=== footer ==="
tmux capture-pane -t qdog -p | tail -2
